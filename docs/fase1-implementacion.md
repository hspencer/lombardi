# Fase 1: Verificación Básica - Implementación Completada

**Fecha**: 2026-03-30
**Estado**: ✅ Implementado

---

## Resumen

Se ha implementado la **Fase 1** del sistema de controversias colaborativo: **Verificación Básica sin Autenticación**. Los usuarios ahora pueden votar sobre contradicciones detectadas automáticamente por el LLM, ver el consenso comunitario y aportar comentarios.

---

## Cambios Implementados

### 1. Backend

#### Schema (`data/schema.json`)
Extendido el edge `CONTRADICE` con nuevos campos:
- `verification_status`: `pending | confirmed | disputed | resolved`
- `consensus_score`: `0.0-1.0` (porcentaje de consenso)
- `vote_agree_count`: contador de votos "confirmo"
- `vote_disagree_count`: contador de votos "falsa alarma"
- `vote_uncertain_count`: contador de votos "no estoy seguro"
- `detected_at`: timestamp ISO de cuándo se detectó

#### Resolver (`backend/resolver.js`)
- Actualizado para crear aristas `CONTRADICE` con los nuevos campos inicializados
- Valores por defecto: `verification_status: 'pending'`, `consensus_score: 0.0`, votos en 0

#### Migración (`backend/migrate_contradice.js`)
- Script creado para actualizar aristas existentes con los nuevos campos
- Ejecutado exitosamente: **4 aristas migradas**

#### API REST (`backend/api.js`)
Nuevo endpoint agregado:

```
POST /api/disputes/:fromId/:toId/verify
```

**Request body**:
```json
{
  "verifier": "Nombre del usuario",
  "vote": "agree | disagree | uncertain",
  "confidence": 0.8,
  "comment": "Texto opcional"
}
```

**Response**:
```json
{
  "ok": true,
  "vote_agree_count": 5,
  "vote_disagree_count": 1,
  "vote_uncertain_count": 0,
  "consensus_score": 0.83,
  "verification_status": "confirmed"
}
```

**Lógica de verificación**:
- Incrementa contadores según el voto
- Calcula `consensus_score = vote_agree / (vote_agree + vote_disagree)`
- Actualiza `verification_status`:
  - `confirmed` si consensus ≥ 0.75 (con mínimo 3 votos)
  - `resolved` si consensus ≤ 0.25 (falsa alarma)
  - `disputed` si está entre 0.25-0.75 (comunidad dividida)
  - `pending` si tiene menos de 3 votos decisivos

---

### 2. Frontend

#### Módulo de Verificación (`frontend/verification.js`)
Nuevo módulo JavaScript con funciones:
- `showEdgeVerification(edge)`: Muestra panel de verificación cuando haces click en una arista CONTRADICE
- `submitVerification()`: Envía voto al backend
- `renderVerificationPanel(edge)`: Genera HTML del panel
- `renderConsensusBar()`: Barra visual de consenso con segmentos coloreados

#### Estilos CSS (`frontend/css/verification.css`)
Nuevo archivo con 300+ líneas de estilos para:
- Panel de verificación
- Botones de voto (agree/disagree/uncertain)
- Barra de consenso segmentada
- Slider de confianza
- Estados de verificación (pending, confirmed, disputed, resolved)
- Feedback de éxito/error

#### Traducciones i18n (`frontend/i18n.js`)
Agregadas 40+ claves de traducción en español e inglés:
- Etiquetas del panel
- Tipos de contradicción
- Estados de verificación
- Mensajes de error/éxito

#### Integración (`frontend/index.html` y `frontend/app.js`)
- Agregado `verification.css` al head
- Agregado `verification.js` antes de `app.js`
- Agregado listener de click en aristas (línea ~621 de app.js):
  ```javascript
  .on('click', function (e, d) {
      if (d.type === 'CONTRADICE' && typeof showEdgeVerification === 'function') {
          e.stopPropagation();
          showEdgeVerification(d);
      }
  });
  ```

---

## Cómo Probar

### 1. Iniciar el servidor

```bash
cd /Users/hspencer/Sites/lombardi
node backend/api.js
```

El servidor debería estar corriendo en `http://localhost:3000`

### 2. Abrir la interfaz

1. Navega a `http://localhost:3000`
2. Haz click en el botón **"+"** junto al logo (activa el modo Lombardispute)
3. Se cargará el subgrafo de eventos disputados

### 3. Verificar una contradicción

1. **Haz click en una arista roja** (CONTRADICE) entre dos eventos
2. Se abrirá el panel de detalle a la derecha con:
   - Nombre de los dos eventos en conflicto
   - Tipo de contradicción (fact/actor/attribute/narrative)
   - Tensión actual (0-100%)
   - Análisis del LLM
   - **Consenso comunitario** (barra segmentada de votos)
   - **Formulario de verificación**

3. **Votar**:
   - Haz click en uno de los tres botones:
     - ✓ **Sí, confirmo** (agree)
     - ✗ **No, falsa alarma** (disagree)
     - ? **No estoy seguro** (uncertain)
   - Ajusta el slider de **confianza** (0-100%)
   - Opcionalmente escribe un **comentario**
   - Ingresa tu **nombre** (se guarda en localStorage)
   - Haz click en **"Enviar verificación"**

4. **Ver resultado**:
   - Aparece mensaje de éxito
   - El panel se actualiza con los nuevos contadores
   - La barra de consenso se ajusta
   - El estado de verificación puede cambiar:
     - `Pendiente` → `Confirmado` (si ≥75% confirman)
     - `Pendiente` → `Resuelto` (si ≤25% confirman)
     - `Pendiente` → `Disputado` (si la comunidad está dividida)

### 4. Probar con múltiples votaciones

Puedes simular múltiples usuarios votando:
1. Vota con un nombre
2. Cambia el nombre en el campo "Tu nombre"
3. Vota de nuevo
4. Repite para ver cómo cambia el consenso

---

## Endpoints de la API

### GET /api/disputes
Retorna el subgrafo de controversias con **campos de verificación incluidos**:

```bash
curl http://localhost:3000/api/disputes
```

Respuesta incluye edges con:
```json
{
  "source": "evento-a",
  "target": "evento-b",
  "type": "CONTRADICE",
  "tension_score": 0.75,
  "contradiction_type": "attribute",
  "analysis": "Las fuentes discrepan en cifras",
  "detected_by": "gemma3:latest",
  "detected_at": "2026-03-30T10:00:00Z",
  "verification_status": "pending",
  "consensus_score": 0.0,
  "vote_agree_count": 0,
  "vote_disagree_count": 0,
  "vote_uncertain_count": 0
}
```

### POST /api/disputes/:fromId/:toId/verify
Registra un voto de verificación:

```bash
curl -X POST http://localhost:3000/api/disputes/evento-a/evento-b/verify \
  -H "Content-Type: application/json" \
  -d '{
    "verifier": "Ana García",
    "vote": "agree",
    "confidence": 0.8,
    "comment": "Las cifras claramente difieren"
  }'
```

---

## Archivos Modificados

```
backend/
├── api.js                    [MODIFICADO] +120 líneas (nuevo endpoint /verify)
├── resolver.js               [MODIFICADO] +5 líneas (campos de verificación)
└── migrate_contradice.js     [NUEVO] Script de migración

data/
└── schema.json               [MODIFICADO] +6 propiedades en CONTRADICE

frontend/
├── index.html                [MODIFICADO] +2 líneas (CSS y JS)
├── app.js                    [MODIFICADO] +6 líneas (listener de click)
├── i18n.js                   [MODIFICADO] +80 líneas (traducciones)
├── verification.js           [NUEVO] 450 líneas
└── css/
    └── verification.css      [NUEVO] 300 líneas

docs/
├── controversias.md          [CREADO] Documentación completa del sistema
└── fase1-implementacion.md   [CREADO] Este documento

spec/
└── controversy-model.allium  [CREADO] Especificación formal Allium v3
```

---

## Limitaciones de Fase 1

Esta implementación es **sin autenticación**. Las limitaciones conocidas:

- ❌ **No hay usuarios reales**: "verifier" es solo un string
- ❌ **Sin prevención de votos duplicados**: Un usuario puede votar múltiples veces cambiando su nombre
- ❌ **Sin sistema de reputación**: Todos los votos pesan igual
- ❌ **Sin auditoría persistente**: Los votos solo incrementan contadores, no se guardan individualmente
- ❌ **Sin edición de votos**: No puedes cambiar tu voto después de enviarlo

Estas limitaciones se resolverán en **Fase 2: Autenticación y Usuarios**.

---

## Próximos Pasos

### Fase 2: Autenticación y Usuarios (4 semanas)
- Tabla `users` en PostgreSQL
- Login/registro básico
- Tabla `verification_votes` para guardar cada voto
- Campos `verified_by`, `challenged_by` en aristas
- Dashboard de perfil de usuario

### Fase 3: Evidencias Múltiples (4-5 semanas)
- Nodos `Evidencia` en el grafo
- Aristas `RESPALDA` (Evidencia → Evento)
- Panel de evidencias en la UI
- Endpoint `/api/events/:id/evidence`

Ver [`docs/controversias.md`](./controversias.md) para el roadmap completo.

---

## Tests Recomendados

### 1. Test básico de votación
- [ ] Click en arista CONTRADICE abre panel
- [ ] Todos los campos están presentes
- [ ] Botones de voto se marcan cuando se hace click
- [ ] Slider de confianza muestra valor actualizado
- [ ] Enviar voto sin nombre muestra error
- [ ] Enviar voto sin selección muestra error
- [ ] Voto exitoso muestra mensaje de éxito
- [ ] Panel se actualiza con nuevos valores

### 2. Test de consenso
- [ ] Votar 3 veces "agree" cambia status a "confirmed"
- [ ] Votar 3 veces "disagree" cambia status a "resolved"
- [ ] Votar 2 "agree" + 2 "disagree" cambia status a "disputed"
- [ ] Barra de consenso muestra proporciones correctas
- [ ] Porcentaje de consenso calcula correctamente

### 3. Test de persistencia
- [ ] Recargar página mantiene los contadores de votos
- [ ] Nombre de verificador se guarda en localStorage
- [ ] Al volver a abrir, el nombre persiste

### 4. Test de API directa
```bash
# Verificar que endpoint responde
curl http://localhost:3000/api/disputes/bundestag-president-gaza-tour/gaza-tour-catastrophe-tourism/verify \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"verifier":"Test","vote":"agree","confidence":0.9}'

# Verificar que cambios persisten
curl http://localhost:3000/api/disputes | jq '.edges[] | select(.type=="CONTRADICE") | {source, target, verification_status, consensus_score, votes: {agree: .vote_agree_count, disagree: .vote_disagree_count}}'
```

---

## Capturas de Pantalla (mockup)

### Panel de Verificación

```
┌────────────────────────────────────────────────────┐
│  Contradicción                    [Pendiente]      │
├────────────────────────────────────────────────────┤
│  [bundestag-president-gaza-tour]                   │
│                  vs                                 │
│  [gaza-tour-catastrophe-tourism]                   │
├────────────────────────────────────────────────────┤
│  Tipo: Narrativa                                   │
│  Tensión: ████████░░ 75%                          │
│  Detectado por: gemma3:latest                      │
├────────────────────────────────────────────────────┤
│  Análisis:                                         │
│  Mismos hechos, encuadres opuestos                │
├────────────────────────────────────────────────────┤
│  Consenso comunitario                 0 votos      │
│  ┌──────────────────────────────────────────────┐ │
│  │ [Sin votos aún]                              │ │
│  └──────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────┤
│  ¿Es válida esta contradicción?                    │
│  [✓ Sí, confirmo] [✗ No] [? No estoy seguro]      │
│                                                     │
│  Tu confianza: ████████░░ 80%                     │
│                                                     │
│  Comentario (opcional):                            │
│  ┌──────────────────────────────────────────────┐ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                     │
│  Tu nombre: [Ana García        ]                   │
│                                                     │
│  [Enviar verificación]                             │
└────────────────────────────────────────────────────┘
```

---

**¡Fase 1 completada exitosamente!** 🎉

El sistema ahora permite verificación colaborativa básica de contradicciones. La arquitectura está lista para escalar a las siguientes fases con autenticación, reputación y evidencias múltiples.
