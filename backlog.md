# OverStand — Backlog

Estado del proyecto al 2026-03-27.

## Completado

- [x] Arquitectura local-first (Docker AGE + Ollama nativo + Node.js)
- [x] RSS fetcher multilingüe (33 feeds, 777 noticias descargadas)
- [x] Schema ontológico auditable (`data/schema.json`)
- [x] Diccionario de aliases auditable (`data/aliases.json`)
- [x] Ingesta con Ollama (llama3.1): extracción JSON → grafo AGE
- [x] Normalización de entidades (aliases) en pipeline de ingesta
- [x] Prompt de extracción en español (predicados, nombres genéricos)
- [x] API REST completa (ego, search, news, stats, schema, aliases)
- [x] Frontend egocéntrico: foco dinámico + grado 1/2 + poda
- [x] Split-view con handle arrastrable
- [x] Panel de detalle con noticias vinculadas ordenadas por fecha
- [x] Buscador con autocompletado y dot de color por tipo de nodo
- [x] Breadcrumbs de navegación
- [x] Iconos external-link (feather) en noticias
- [x] Nodos con estilos visuales diferenciados por tipo
- [x] CSS separado en capas semánticas (variables, layout, graph, detail)
- [x] Runner resiliente (`ingest-runner.sh`) para ingesta continua
- [x] Extracción persistente (`.extraction.json`) — no re-inferir al reprocesar
- [x] Descriptores de entidad (`desc`) en prompt y grafo
- [x] Relaciones implícitas (`entity_relations`: PARTICIPA, UBICADO_EN, PERTENECE_A)
- [x] Editor de nodos: cambiar tipo, editar aliases, merge con confirmación
- [x] Enriquecimiento desde Wikidata (preview + apply)
- [x] Grafo de conocimiento general (seed: `data/seed-knowledge.json`)
- [x] Búsqueda e ingesta de noticias desde UI por nodo
- [x] Panel de procesamiento con barra de progreso y fetch RSS
- [x] i18n (ES/EN) con browser detect, toggle, y localStorage
- [x] Vista Titles (tipografía como nodos, collision de bounding box)
- [x] Colores por tipo de entidad (Person=azul, Location=verde, Organization=naranja)
- [x] Radios proporcionales al degree, labels truncados, aristas curvas
- [x] Grado 2 filtrado (solo Actores), Afirmaciones no navegables como focal

## En progreso

- [ ] **Ingesta masiva** — 777 noticias, ~200 procesadas (~25%). Runner corriendo en background.

## Backlog

### Alta prioridad

- [x] ~~i18n + selector de idioma~~ ✓
- [x] ~~Editor de nodos (tipo, aliases, merge, delete)~~ ✓
- [x] ~~Editor de aliases desde UI~~ ✓
- [x] ~~Guardar extracciones de Ollama~~ ✓
- [x] ~~Grafo de conocimiento general (seed)~~ ✓
- [x] ~~Consola de procesamiento en UI~~ ✓
- [x] ~~Breadcrumbs semánticos con aristas~~ ✓
- [ ] **Nodo Evento en ingesta** — Está en schema pero `ingest.js` no lo extrae como nodo separado. Actualmente `event_type` es solo un campo en Afirmacion.
- [ ] **Aristas semánticas en ingesta** — Solo se crean REPORTA e INVOLUCRA. Faltan: SOSTIENE, CAUSA, COMPLEMENTA, DESMIENTE, ACTUALIZA.
- [ ] **Resolver de contradicciones** — Usar qwen3.5 para detectar CONTRADICE entre afirmaciones del mismo hecho. Genera aristas con `tension_score`.
- [ ] **Reprocesamiento de noticias** — Separar ingesta (RSS→JSON) de procesamiento (JSON→extracción→grafo). Poder reprocesar con nuevo prompt/modelo sin re-ingestar.
- [ ] **i18n de nodos** — Guardar `name_es` y `name_en` por nodo para que los títulos cambien con el idioma de la interfaz.

### Media prioridad

- [ ] **Estela temporal** — Opacidad de nodos según antigüedad (1.0 recientes → 0.3 viejos). Necesita `ingested_at` propagado a nodos del grafo.
- [ ] **Nodo vibrante (pulso)** — Animación CSS para afirmaciones con múltiples aristas CONTRADICE. El CSS existe, falta activarlo con datos reales.
- [ ] **Mapa de calor de autoridad** — Glow en actores con muchas aristas DESMIENTE.
- [ ] **Zoom adaptativo calibrado** — Que grado 1 ocupe exactamente 60% del viewport. `autoZoom` existe pero no está calibrado.
- [ ] **Migrar extractor a qwen3.5** — Mejor calidad pero 3x más lento. Evaluar con `/no_think` o usar solo para subset de noticias complejas.
- [ ] **Labels de aristas en hover** — Implementado parcialmente, verificar que funcione con todos los tipos de arista.

### Higiene del Grafo (Poda Neuronal y Caducidad Estructural)

El grafo debe comportarse como un organismo vivo: lo que no se usa o pierde relevancia temporal, se atrofia y desaparece.

- [ ] **TTL para Afirmaciones y Noticias** — Aristas REPORTA y nodos Afirmación >30 días sin CONTRADICE activas se archivan. Si generó fricción (Sd alto), se guarda más tiempo. Noticias de consenso total se podan rápido.
- [ ] **Capas Static vs Volatile** — Capa Estática (Actores, Países, Empresas: no mueren, se actualizan vía Wikidata). Capa Volátil (Eventos, Afirmaciones: nacen y mueren, 90% del volumen). Capa Archivo (flag `is_historical: true` para eventos históricos que no se borran).
- [ ] **Índice de Calor (Heat Retention)** — Atributos `last_accessed` y `view_count` en cada nodo. Si navegaste por un nodo, su energía se recarga. Si no ha sido Foco ni recibió updates en 15 días, el daemon lo desconecta.
- [ ] **Garbage Collector (Daemon Nocturno)** — Script de Node que corre limpieza Cypher diaria: elimina noticias >30 días sin disputa, nodos huérfanos, aristas muertas. Objetivo: queries Cypher <100ms en M3.
- [ ] **Grafo Fantasma (Lazy Loading de Wikidata)** — Al ingerir solo guardar ID+nombre. Detalles se traen solo al hacer Click (Foco). Al cerrar sesión, si el nodo no es "core", limpiar detalles pesados y dejar solo el ID.

### Interacciones de Soberania Informativa

El usuario no consume una lista; habita un nodo. El cambio de foco reconfigura la ontologia visible.

**Afirmacion (el atomo de la disputa):**
- [ ] **Triangular (Cross-Check)** — Click en afirmacion resalta otras afirmaciones del mismo Evento desde fuentes opuestas (Xinhua vs BBC).
- [ ] **Rastrear linaje (Ancestry)** — Linea de tiempo con aristas ACTUALIZA: como la narrativa cambio con las horas.
- [ ] **Evaluar tension (Sd)** — "Ver Friccion": mapa de calor de fuentes que sostienen vs desmienten.
- [ ] **Evidencia raw** — Acceso al texto original en idioma de la fuente para verificar alucinaciones de la IA.

**Actor (la red de poder):**
- [x] ~~Mapa de influencia~~ — Parcialmente implementado: egosistema ya muestra radio de impacto del actor.
- [ ] **Contradiccion historica** — Buscar en archivo: cuando este actor dijo lo contrario a lo que dice hoy.
- [x] ~~Conexion de sentido comun~~ — Implementado via Wikidata enrichment.

**Foco (navegacion tactica):**
- [x] ~~Pivot~~ — Doble click recentra. Implementado.
- [ ] **Filtrar por burbuja** — "Ver el mundo segun [Fuente X]": atenuar todo lo que esa fuente no reporto.
- [ ] **Forecast Mode** — Animar aristas CAUSA: como un evento pasado "empujo" al actual.

**Accion cognitiva:**
- [ ] **El Contrastador** — Seleccionar 2 afirmaciones contradictorias y pedir a Ollama: "Genera reporte de la brecha" (no dice quien tiene razon, analiza omisiones y sesgos).
- [ ] **Runners alternativos** — OpenAI API y Gemini API como backends de extraccion ademas de Ollama.

### Baja prioridad

- [x] ~~README actualizado~~ ✓
- [x] ~~Commit inicial limpio~~ ✓
- [x] ~~Breadcrumbs semanticos~~ ✓
- [ ] **Filtros en el grafo** — Por tipo de evento, fuente, fecha.
- [ ] **Export PNG del grafo** — Boton para descargar vista actual.
- [ ] **3D mode** — Vista Three.js alternativa (como constel-db).
- [ ] **Deteccion de clusters** — Agrupar visualmente nodos por tema/region.
