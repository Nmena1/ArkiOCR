# SKILL: Platform — GCP Enterprise Standards

**Dominio:** platform  
**Versión:** v1.0.0  
**Capa:** 1 — Obligatorio  
**Dependencias:** core/v1.0.0  

---

## CUÁNDO CARGAR ESTE SKILL

- Request menciona: GCP, Google Cloud, Kubernetes, Cloud Run, GKE, BigQuery, Cloud SQL, Pub/Sub
- Diseño de infraestructura en Google Cloud
- Revisión de Terraform con recursos GCP
- Cualquier despliegue en cloud pública

---

## JERARQUÍA DE RECURSOS GCP — MODELO OBLIGATORIO

```
Organization
└── Folders (por ambiente o unidad de negocio)
    ├── folder/producción
    │   ├── project/prod-networking        # Solo VPC, DNS, Interconnect
    │   ├── project/prod-security          # SIEM, KMS, Secret Manager
    │   ├── project/prod-data              # BigQuery, Cloud SQL
    │   └── project/prod-apps-{servicio}   # Aplicaciones (1 proyecto por servicio grande)
    ├── folder/no-producción
    │   ├── project/staging-apps
    │   └── project/dev-apps
    └── folder/shared-services
        ├── project/shared-ci-cd           # Cloud Build, Artifact Registry
        ├── project/shared-monitoring      # Cloud Monitoring, Logging centralizado
        └── project/shared-networking     # Shared VPC host project
```

**Regla:** Nunca mezclar workloads de producción con dev/staging en el mismo proyecto.

---

## TERRAFORM — MÓDULO BASE GCP PROJECT

```hcl
# modules/gcp-project/main.tf

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

resource "google_project" "project" {
  name            = var.project_name
  project_id      = var.project_id
  folder_id       = var.folder_id
  billing_account = var.billing_account_id

  labels = {
    environment     = var.environment
    owner           = var.owner_team
    cost_center     = var.cost_center
    data_classification = var.data_classification # public/internal/confidential/restricted
    compliance      = var.compliance_framework    # iso27001/sox/hipaa/none
  }
}

# APIs mínimas requeridas
resource "google_project_service" "required_apis" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "cloudkms.googleapis.com",
    "secretmanager.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudtrace.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "servicenetworking.googleapis.com",
  ])

  project = google_project.project.project_id
  service = each.key

  disable_on_destroy = false
}

# Audit logs obligatorios
resource "google_project_iam_audit_config" "project_audit" {
  project = google_project.project.project_id
  service = "allServices"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# Outputs necesarios para módulos dependientes
output "project_id" {
  value = google_project.project.project_id
}
output "project_number" {
  value = google_project.project.number
}
```

---

## GKE — CLUSTER ENTERPRISE (HARDENED)

```hcl
# modules/gke-cluster/main.tf

resource "google_container_cluster" "primary" {
  name     = "${var.cluster_name}-${var.environment}"
  project  = var.project_id
  location = var.region  # Regional para HA

  # Habilitar Autopilot para reducir overhead operacional
  # O usar Standard con configuración hardened:
  enable_autopilot = var.use_autopilot

  # Standard mode hardening:
  dynamic "node_config" {
    for_each = var.use_autopilot ? [] : [1]
    content {
      machine_type = var.node_machine_type
      disk_type    = "pd-ssd"
      disk_size_gb = 100

      # Workload Identity por nodo
      workload_metadata_config {
        mode = "GKE_METADATA"
      }

      # Shielded nodes
      shielded_instance_config {
        enable_secure_boot          = true
        enable_integrity_monitoring = true
      }

      # Sin acceso a metadata del nodo (excepto workload identity)
      metadata = {
        disable-legacy-endpoints = "true"
      }

      oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    }
  }

  # Networking privado
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = var.environment == "production"
    master_ipv4_cidr_block  = var.master_cidr
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  network    = var.network_name
  subnetwork = var.subnetwork_name

  # Workload Identity a nivel cluster
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Binary Authorization (solo imágenes firmadas en prod)
  binary_authorization {
    evaluation_mode = var.environment == "production" ? "PROJECT_SINGLETON_POLICY_ENFORCE" : "DISABLED"
  }

  # Addons requeridos
  addons_config {
    http_load_balancing { disabled = false }
    network_policy_addon { disabled = false }
    gcs_fuse_csi_driver_config { enabled = true }
    
    # Config Connector para gestionar recursos GCP desde K8s
    config_connector_config { enabled = true }
  }

  # Network Policy
  network_policy {
    enabled  = true
    provider = "CALICO"
  }

  # Logging y monitoring con Cloud Operations
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS", "APISERVER"]
  }
  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
    managed_prometheus { enabled = true }
  }

  # Maintenance window: fuera de horas críticas
  maintenance_policy {
    recurring_window {
      start_time = "2023-01-01T04:00:00Z"
      end_time   = "2023-01-01T08:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SA,SU"
    }
  }

  # Release channel: Regular para balance estabilidad/features
  release_channel {
    channel = var.environment == "production" ? "STABLE" : "REGULAR"
  }

  lifecycle {
    ignore_changes = [initial_node_count]
  }
}
```

---

## KUBERNETES — NAMESPACES Y RBAC

```yaml
# k8s/base/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: app-production
  labels:
    environment: production
    team: platform
    istio-injection: enabled  # Service mesh automático
    pod-security.kubernetes.io/enforce: restricted  # PSA nivel restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
# RBAC mínimo para aplicación
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: app-production
  name: app-role
rules:
  # Solo lo necesario para la aplicación
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: []  # Nunca acceso directo a secrets — usar Workload Identity + Secret Manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-role-binding
  namespace: app-production
subjects:
  - kind: ServiceAccount
    name: app-service-account
    namespace: app-production
roleRef:
  kind: Role
  name: app-role
  apiGroup: rbac.authorization.k8s.io
```

---

## CLOUD SQL — CONFIGURACIÓN SEGURA

```hcl
# modules/cloud-sql/main.tf

resource "google_sql_database_instance" "postgres" {
  name             = "${var.instance_name}-${var.environment}"
  project          = var.project_id
  database_version = "POSTGRES_15"
  region           = var.region

  deletion_protection = var.environment == "production"

  settings {
    tier              = var.machine_type
    availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"
    
    disk_type       = "PD_SSD"
    disk_size       = var.disk_size_gb
    disk_autoresize = true

    # ❌ Sin IP pública en producción
    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_network_id
      require_ssl     = true

      # Solo permitir rangos de GKE/Cloud Run
      dynamic "authorized_networks" {
        for_each = var.environment == "production" ? [] : var.dev_authorized_ips
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.cidr
        }
      }
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.environment == "production" ? 30 : 7
        retention_unit   = "COUNT"
      }
    }

    # Flags de seguridad PostgreSQL
    database_flags {
      name  = "log_checkpoints"
      value = "on"
    }
    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }
    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"  # Log queries > 1 segundo
    }
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"  # Autenticación IAM de GCP
    }
  }
}
```

---

## SECRET MANAGER — USO OBLIGATORIO

```typescript
// utils/secrets.util.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

/**
 * Acceso a secretos via Workload Identity (sin API keys)
 * NUNCA usar Application Default Credentials con SA key files en prod
 */
export async function getSecret(secretName: string, version = 'latest'): Promise<string> {
  const projectId = process.env.GCP_PROJECT_ID;
  
  if (!projectId) {
    throw new Error('GCP_PROJECT_ID no configurado');
  }
  
  const name = `projects/${projectId}/secrets/${secretName}/versions/${version}`;
  
  const [response] = await client.accessSecretVersion({ name });
  
  if (!response.payload?.data) {
    throw new Error(`Secreto no encontrado: ${secretName}`);
  }
  
  return response.payload.data.toString();
}

// Pattern recomendado: cachear en memoria con TTL
const secretCache = new Map<string, { value: string; expiresAt: number }>();

export async function getCachedSecret(
  secretName: string,
  ttlMs = 5 * 60 * 1000 // 5 minutos
): Promise<string> {
  const cached = secretCache.get(secretName);
  
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  
  const value = await getSecret(secretName);
  secretCache.set(secretName, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  
  return value;
}
```

---

## CHECKLIST CLOUD — ANTES DE DEPLOY A PRODUCCIÓN

```
□ ¿Proyecto en folder correcto con labels de clasificación?
□ ¿Audit logs habilitados para allServices?
□ ¿VPC con Private Google Access habilitado?
□ ¿Cloud SQL sin IP pública?
□ ¿GKE con Private Cluster + Workload Identity?
□ ¿Binary Authorization habilitado?
□ ¿Secretos en Secret Manager (no en env vars inline)?
□ ¿Networking entre servicios vía VPC (no internet público)?
□ ¿Cloud Armor configurado para APIs públicas?
□ ¿Budget Alerts configurados?
□ ¿Retención de logs mínima 1 año para gov, 90 días para empresa?
□ ¿CMEK configurado para datos clasificados como confidential/restricted?
```
