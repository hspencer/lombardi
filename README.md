# OverStanding (OS)

Sistema de inteligencia de fuentes que mapea la arquitectura de la informacion en tiempo real. Su funcion principal es la **triangulacion ontologica**: no busca una "verdad" unica, sino que visualiza las relaciones de consistencia, complemento y contradiccion entre multiples fuentes.

## Arquitectura

```
                  ┌─────────────────────────────────────┐
                  │           CAPA DE APLICACION         │
                  │            (Nativa macOS)            │
                  │                                      │
                  │  Node.js (backend)   D3.js (frontend)│
                  └──────────┬──────────────┬────────────┘
                             │              │
                  ┌──────────▼──────────┐   │
                  │  CAPA DE INTELIGENCIA│   │
                  │   (Nativa macOS)     │   │
                  │                      │   │
                  │  Ollama              │   │
                  │  ├ Llama 3 (8B)      │   │
                  │  └ Command R (35B)   │   │
                  └──────────┬───────────┘   │
                             │               │
                  ┌──────────▼───────────────▼───────────┐
                  │        CAPA DE INFRAESTRUCTURA       │
                  │              (Docker)                 │
                  │                                      │
                  │  Apache AGE (PostgreSQL + Grafos)     │
                  └──────────────────────────────────────┘
```

- **Docker** solo para Apache AGE. Compilar la extension en macOS es inestable; Docker encapsula esa complejidad.
- **Ollama** nativo para aprovechar la Unified Memory Architecture y el Neural Engine del M3.
- **Node.js** nativo para acceso directo al filesystem (`fs.watch`) y bajo consumo de recursos.
- **D3.js** vanilla para control total del DOM y animaciones de grafos de alta performance.

## Stack

| Componente | Tecnologia | Razon |
| :--- | :--- | :--- |
| Persistencia | Apache AGE (Postgres) | SQL para texto de noticias, Cypher para la red de relaciones |
| IA Local | Ollama (Llama 3 + Command R) | Inferencia sobre 36GB de RAM unificada del M3 |
| IA Cloud | Claude 3.5 Sonnet | Arbitraje semantico cuando el Score de Disputa > 0.15 |
| Ingesta | Node.js (fs.watch) | Daemon que vigila carpetas y procesa archivos al aparecer |
| Visualizacion | D3.js (Force-Directed) | Nodos se repelen segun nivel de contradiccion |
| Consultas | OpenCypher | Navegacion del grafo de relaciones entre fuentes |

## Ontologia

El sistema normaliza la realidad en cuatro tipos de nodos:

- **Actor**: Entidad con ID unico en kebab-case (ej: `gobierno-ucrania`)
- **Afirmacion (Claim)**: El atomo de informacion. Cita textual + autor + timestamp
- **Evento**: Punto de convergencia donde se vinculan multiples afirmaciones
- **Noticia**: Contenedor original (URL, medio, fecha)

### Relaciones

| Relacion | Origen | Destino | Descripcion |
| :--- | :--- | :--- | :--- |
| `REPORTA` | Noticia | Afirmacion | La noticia es el vehiculo del mensaje |
| `SOSTIENE` | Afirmacion | Evento | La afirmacion describe que paso |
| `CONTRADICE` | Afirmacion | Afirmacion | Versiones opuestas del mismo hecho |
| `INVOLUCRA` | Evento | Actor | Quienes estan en la escena |
| `UBICADO_EN` | Evento | Lugar | Donde ocurrio |

### Score de Disputa

Cuando las fuentes se dividen sobre un hecho, el sistema calcula:

```
Sd = (N_fuentes_A × N_fuentes_B) / N_total²
```

Si las fuentes estan 50/50, el score es maximo. Si todas coinciden, es 0. Este valor controla la intensidad visual del nodo en el grafo.

## Diccionario de Eventos

El LLM clasifica cada noticia en una de estas categorias para evitar la explosion de sinonimos:

**Poder y Gobernanza**
`CAMBIO_LIDERAZGO` · `PROMULGACION_NORMA` · `PROTESTA_SOCIAL` · `RUPTURA_DIPLOMATICA`

**Conflicto y Seguridad**
`ACCION_ARMADA` · `AMENAZA_COERCION` · `INCAUTACION_DETENCION` · `ACUERDO_PAZ`

**Flujos Economicos**
`ADQUISICION_FUSION` · `SANCION_ECONOMICA` · `LANZAMIENTO_PRODUCTO` · `QUIEBRA_INSOLVENCIA`

**Discurso y Verdad**
`DECLARACION_PUBLICA` · `DENUNCIA_ACUSACION` · `FILTRACION` · `DESMENTIDO`

Si ninguna aplica, se usa `EVENTO_GENERICO`.

## Pipeline

```
RSS Feeds ──► rss_fetcher.js ──► /data/raw_news/
                                       │
                                       ▼
                                 ingest.js (fs.watch)
                                       │
                            ┌──────────▼──────────┐
                            │  Ollama (Llama 3)   │
                            │  Extraccion JSON    │
                            └──────────┬──────────┘
                                       │
                            ┌──────────▼──────────┐
                            │  Apache AGE         │
                            │  Busca evento previo│
                            └──────────┬──────────┘
                                       │
                              ¿Contradiccion?
                              /              \
                            NO               SI
                            │                 │
                         Guardar      ┌───────▼────────┐
                         nodo         │ Command R / Claude│
                                      │ Analisis de     │
                                      │ contradiccion   │
                                      └───────┬────────┘
                                              │
                                     Crear arista
                                     CONTRADICE
```

1. **Captura**: `rss_fetcher.js` lee `data/sources/feeds.csv`, descarga titulares y los guarda en `/data/raw_news/`
2. **Analisis**: `ingest.js` detecta el archivo, pide a Llama 3 (Ollama) el JSON ontologico
3. **Cruce**: Busca en el grafo si ese hecho ya existe en una ventana temporal similar
4. **Tension**: Si hay version contradictoria, Command R o Claude analiza la friccion y crea la arista `[:CONTRADICE]`
5. **Visualizacion**: `localhost` muestra el grafo D3 con nodos parpadeando segun su nivel de disputa

## Estructura de Archivos

```
overstanding/
├── docker-compose.yml          # Levanta Apache AGE
├── data/
│   ├── db/                     # Datos de Postgres (persistentes, fuera de Docker)
│   ├── raw_news/               # Noticias descargadas para procesar
│   └── sources/
│       └── feeds.csv           # Base de feeds RSS (33 fuentes curadas)
├── backend/
│   ├── ingest.js               # Daemon: fs.watch + Ollama + Cypher/SQL
│   ├── rss_fetcher.js          # Recolector de feeds internacionales
│   └── api.js                  # Servidor HTTP vanilla para alimentar D3
└── frontend/
    ├── index.html              # Contenedor SVG para D3.js
    ├── app.js                  # Motor de fuerzas, drags y visualizacion
    └── styles.css              # Estetica de sala de guerra informativa
```

## Fuentes

La base incluye 33 feeds RSS curados en `data/sources/feeds.csv`, equilibrados por:

- **Geografia**: UK, US, Qatar, Alemania, China, Israel, Rusia, Ucrania, Francia, Australia, Japon, India, Argentina
- **Propiedad**: servicio publico, agencia estatal, medio comercial, independiente, partisan
- **Espectro ideologico**: desde Breitbart (derecha) hasta Jacobin (socialista), pasando por BBC, AP, DW (centro)

## Requisitos

- macOS con Apple Silicon (M3)
- Docker Desktop
- Ollama (con Llama 3 y Command R descargados)
- Node.js 20+
