# SKILL: Integration — Plataformas Gubernamentales & Interoperabilidad

**Dominio:** integration  
**Versión:** v1.0.0  
**Capa:** 5 — Condicional  
**Dependencias:** core/v1.0.0, security/v1.0.0/oauth2-oidc.md, architecture/v1.0.0/api-design.md  

---

## CUÁNDO CARGAR ESTE SKILL

- Integración con SAT, IMSS, ISSSTE, CURP, RFC
- Plataforma Digital Nacional (PDN), CONACYT, SEP
- Firma electrónica (FIEL, e.firma)
- Interoperabilidad entre dependencias
- Cualquier integración con servicios del gobierno mexicano

---

## PRINCIPIOS DE INTEROPERABILIDAD GUBERNAMENTAL

```yaml
principios:
  
  soberania_datos:
    - Los datos ciudadanos NO salen del territorio nacional
    - Almacenamiento en datacenter mexicano o GCP región México
    - No transferir PII a proveedores externos sin consentimiento explícito
    
  minimo_privilegio_datos:
    - Solicitar solo los datos estrictamente necesarios
    - No almacenar datos que pueden consultarse en tiempo real
    - Tiempo de retención definido y auditado
    
  consentimiento:
    - Consentimiento explícito para uso de datos ciudadanos
    - Registro inmutable de consentimientos
    - Mecanismo de revocación de consentimiento
    
  trazabilidad:
    - Toda consulta de datos ciudadanos queda registrada
    - Quién consultó, cuándo, qué dato, para qué propósito
    - Logs inmutables (Cloud Storage + WORM)
    
  disponibilidad:
    - SLA mínimo 99.5% para servicios de gobierno
    - Circuit breakers para dependencias externas
    - Modo degradado definido cuando servicios externos no responden
```

---

## INTEGRACIÓN CON SAT — VALIDACIÓN RFC

```typescript
// integrations/sat/sat-rfc.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { AuditService } from '../../audit/audit.service';
import { firstValueFrom, timeout, catchError } from 'rxjs';

export interface RFCValidationResult {
  valid: boolean;
  nombre?: string;
  estado: 'activo' | 'cancelado' | 'no_encontrado';
  timestamp: string;
}

@Injectable()
export class SatRfcService {
  private readonly logger = new Logger(SatRfcService.name);
  
  constructor(
    private readonly http: HttpService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly audit: AuditService,
  ) {}
  
  async validarRFC(
    rfc: string,
    solicitante: string,  // userId de quien hace la consulta
    proposito: string,    // Para qué se consulta (audit)
  ): Promise<RFCValidationResult> {
    
    // Validación local del formato ANTES de consultar el SAT
    if (!this.validarFormatoRFC(rfc)) {
      return {
        valid: false,
        estado: 'no_encontrado',
        timestamp: new Date().toISOString(),
      };
    }
    
    // Log de auditoría ANTES de la consulta (nunca perder la trazabilidad)
    await this.audit.registrar({
      evento: 'CONSULTA_RFC_SAT',
      solicitante,
      recurso: `rfc:${this.enmascararRFC(rfc)}`,  // NUNCA loggear RFC completo
      proposito,
      timestamp: new Date().toISOString(),
    });
    
    // Circuit breaker para resiliencia
    return this.circuitBreaker.execute<RFCValidationResult>(
      'sat-rfc',
      async () => {
        const response = await firstValueFrom(
          this.http
            .get(`${process.env.SAT_API_URL}/rfc/validar`, {
              params: { rfc },
              headers: {
                'Authorization': `Bearer ${await this.getSatToken()}`,
                'X-Dependencia': process.env.DEPENDENCIA_CLAVE,
                'X-Request-Id': crypto.randomUUID(),
              },
              timeout: 10000,  // 10 segundos máximo
            })
            .pipe(
              timeout(10000),
              catchError((err) => {
                this.logger.error(`Error SAT RFC: ${err.message}`);
                throw new SatIntegrationError('SAT no disponible', err);
              }),
            ),
        );
        
        return {
          valid: response.data.valido,
          nombre: response.data.nombre,
          estado: response.data.estado,
          timestamp: new Date().toISOString(),
        };
      },
      // Fallback cuando el circuit está abierto
      () => ({
        valid: false,
        estado: 'no_encontrado' as const,
        timestamp: new Date().toISOString(),
      }),
    );
  }
  
  private validarFormatoRFC(rfc: string): boolean {
    // Persona Física: 13 caracteres
    // Persona Moral: 12 caracteres
    const rfcPattern = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
    return rfcPattern.test(rfc?.toUpperCase().trim() || '');
  }
  
  private enmascararRFC(rfc: string): string {
    // Mostrar solo últimos 3 caracteres para logs
    return `***${rfc.slice(-3)}`;
  }
}
```

---

## VALIDACIÓN DE CURP

```typescript
// integrations/renapo/curp.service.ts

export class CurpValidationService {
  
  // Validación local (sin consulta a RENAPO)
  validarFormatoCURP(curp: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!curp) {
      return { valid: false, errors: ['CURP requerida'] };
    }
    
    const curpNorm = curp.toUpperCase().trim();
    
    if (curpNorm.length !== 18) {
      errors.push(`Longitud incorrecta: ${curpNorm.length} (se esperan 18 caracteres)`);
    }
    
    const pattern = /^[A-Z]{4}[0-9]{6}[HM]{1}[A-Z]{2}[A-Z]{3}[0-9A-Z]{1}[0-9]{1}$/;
    if (!pattern.test(curpNorm)) {
      errors.push('Formato de CURP inválido');
    }
    
    // Validar fecha de nacimiento (posiciones 4-9)
    if (errors.length === 0) {
      const anio = parseInt(curpNorm.substring(4, 6));
      const mes = parseInt(curpNorm.substring(6, 8));
      const dia = parseInt(curpNorm.substring(8, 10));
      
      if (mes < 1 || mes > 12) errors.push('Mes de nacimiento inválido');
      if (dia < 1 || dia > 31) errors.push('Día de nacimiento inválido');
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  // ⚠️ Consulta a RENAPO solo cuando sea ESTRICTAMENTE necesario
  // Requiere convenio firmado con SEGOB
  async consultarRENAPO(curp: string, propositoJuridico: string): Promise<CurpData> {
    if (!propositoJuridico) {
      throw new Error('Propósito jurídico requerido para consulta RENAPO');
    }
    
    // Requiere token institucional con scope específico
    // ...
  }
}
```

---

## FIRMA ELECTRÓNICA (e.firma / FIEL)

```typescript
// integrations/efirma/efirma.service.ts
import * as forge from 'node-forge';

export class EFirmaService {
  
  /**
   * Verificar firma electrónica del SAT (e.firma)
   * Útil para autenticación de personas físicas/morales en trámites gov
   */
  async verificarFirma(params: {
    datos: string;           // Cadena original firmada
    firma: string;           // Firma en base64
    certificadoPem: string;  // Certificado .cer del firmante
  }): Promise<VerificacionFirmaResult> {
    
    try {
      // 1. Parsear certificado
      const cert = forge.pki.certificateFromPem(params.certificadoPem);
      
      // 2. Verificar que el certificado es emitido por el SAT
      const issuerOrg = cert.issuer.getField('O')?.value;
      if (!issuerOrg?.includes('SAT')) {
        return { valida: false, error: 'Certificado no emitido por SAT' };
      }
      
      // 3. Verificar vigencia del certificado
      const ahora = new Date();
      if (ahora < cert.validity.notBefore || ahora > cert.validity.notAfter) {
        return { valida: false, error: 'Certificado expirado o no vigente' };
      }
      
      // 4. Verificar la firma criptográfica
      const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
      const md = forge.md.sha256.create();
      md.update(params.datos, 'utf8');
      
      const firmaBytes = forge.util.decode64(params.firma);
      const firmaForge = forge.util.createBuffer(firmaBytes, 'raw');
      
      const valida = publicKey.verify(md.digest().bytes(), firmaForge.bytes());
      
      return {
        valida,
        titular: {
          nombre: cert.subject.getField('CN')?.value,
          rfc: cert.subject.getField('serialName')?.value,
          certificadoSerie: cert.serialNumber,
        },
        vigente: {
          desde: cert.validity.notBefore,
          hasta: cert.validity.notAfter,
        },
      };
    } catch (error) {
      this.logger.error('Error verificando e.firma', error);
      return { valida: false, error: 'Error procesando la firma' };
    }
  }
}
```

---

## CIRCUIT BREAKER — RESILIENCIA PARA INTEGRACIONES EXTERNAS

```typescript
// infrastructure/circuit-breaker/circuit-breaker.service.ts
import { Injectable } from '@nestjs/common';

enum CircuitState {
  CLOSED,    // Normal — permite requests
  OPEN,      // Fallo — rechaza requests
  HALF_OPEN, // Probando — permite uno de prueba
}

interface CircuitConfig {
  failureThreshold: number;     // Fallos para abrir
  successThreshold: number;     // Éxitos para cerrar desde half-open
  timeout: number;              // ms en OPEN antes de pasar a HALF_OPEN
  monitoringWindow: number;     // ms para contar fallos
}

@Injectable()
export class CircuitBreakerService {
  private circuits = new Map<string, {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    config: CircuitConfig;
  }>();
  
  private readonly defaultConfig: CircuitConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,          // 1 minuto
    monitoringWindow: 60000, // 1 minuto
  };
  
  async execute<T>(
    name: string,
    operation: () => Promise<T>,
    fallback: () => T,
    config?: Partial<CircuitConfig>,
  ): Promise<T> {
    
    const circuit = this.getOrCreateCircuit(name, { ...this.defaultConfig, ...config });
    
    if (circuit.state === CircuitState.OPEN) {
      // Verificar si es momento de pasar a HALF_OPEN
      if (Date.now() - circuit.lastFailureTime > circuit.config.timeout) {
        circuit.state = CircuitState.HALF_OPEN;
      } else {
        this.logger.warn(`Circuit OPEN para ${name} — usando fallback`);
        return fallback();
      }
    }
    
    try {
      const result = await operation();
      
      if (circuit.state === CircuitState.HALF_OPEN) {
        circuit.successes++;
        if (circuit.successes >= circuit.config.successThreshold) {
          circuit.state = CircuitState.CLOSED;
          circuit.failures = 0;
          this.logger.log(`Circuit CERRADO para ${name}`);
        }
      }
      
      return result;
    } catch (error) {
      circuit.failures++;
      circuit.lastFailureTime = Date.now();
      
      if (circuit.failures >= circuit.config.failureThreshold) {
        circuit.state = CircuitState.OPEN;
        this.logger.error(`Circuit ABIERTO para ${name} — ${circuit.failures} fallos`);
        
        // Alerta a monitoreo
        this.metrics.circuitBreakerOpen.labels({ service: name }).set(1);
      }
      
      throw error;
    }
  }
}
```

---

## REGLAS DE INTEROPERABILIDAD — CHECKLIST

```
□ ¿Existe convenio/acuerdo de intercambio de datos firmado?
□ ¿El propósito jurídico de cada consulta está documentado?
□ ¿Toda consulta de datos ciudadanos queda en audit log?
□ ¿Los datos PII están enmascarados en logs?
□ ¿Existe mecanismo de circuit breaker para el servicio externo?
□ ¿Hay modo degradado cuando el servicio externo no responde?
□ ¿Los tiempos de respuesta del servicio externo están monitoreados?
□ ¿Las claves de integración están en Secret Manager (no en código)?
□ ¿El certificado de cliente es válido y tiene proceso de renovación?
□ ¿Existe documentación del API del servicio externo versionada?
□ ¿Hay tests de integración con mocks para CI/CD?
□ ¿El SLA del servicio externo está contemplado en el SLA propio?
□ ¿Los datos solo se retienen el tiempo estrictamente necesario?
□ ¿El almacenamiento cumple con soberanía de datos (México)?
```
