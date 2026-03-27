# Lombardi

Es un visualizador de noticias, homenaje a [Mark Lombardi](https://en.wikipedia.org/wiki/Mark_Lombardi) (1951–2000), artista que dedicó su vida a dibujar a mano las redes ocultas del poder: bancos, políticos, traficantes de armas y sus conexiones invisibles. Sus dibujos son grafos de conspiración — mapas de relaciones que el periodismo convencional no podía (o no quería) articular.

![Carlos Cardoen, Industrias Cardoen, Chile, 1982–94 (séptima versión)](docs/industries-carlos-cardoen-of-santiago.png)

*Mark Lombardi — Carlos Cardoen, Industrias Cardoen, Chile, 1982–94 (séptima versión), 1999. Grafito sobre papel. MoMA, Nueva York.*

**Lombardi** automatiza lo que Mark L. hacía a mano: trazar las líneas entre actores, eventos y contradicciones a partir del flujo noticioso mundial, usando inteligencia artificial local para que la soberanía sobre los datos permanezca en manos del investigador.

![Lombardi — interfaz](docs/screenshot.png)

## Funcionalidades

- **Ingesta de noticias** — Feeds RSS configurables con toggle on/off por fuente
- **Temas de interés** — Filtra el flujo noticioso por queries relevantes para el investigador
- **Extracción ontológica** — LLMs locales (Ollama) extraen actores, eventos y relaciones
- **Grafo de conocimiento** — Apache AGE (PostgreSQL + Cypher) como base
- **Visualización egocéntrica** — Grafo navegable con foco dinámico y grados de separación
- **Detección de contradicciones** — Identifica tensiones entre fuentes sobre un mismo evento
- **Edición de nodos** — Tipos, aliases, merge, descripción, eliminación
- **Enriquecimiento** — Wikidata + Claude API (on-demand, streaming)
- **Gestión de fuentes** — CRUD completo de feeds RSS y temas de interés
- **i18n** — Español / English con detección automática
- **Tema claro/oscuro**

## Stack

| Capa | Tecnología | Rol |
|:---|:---|:---|
| Base de datos | Apache AGE (Docker) | Grafo + SQL híbrido |
| IA local | Ollama (nativo M3) | Extracción ontológica batch |
| IA on-demand | Claude API | Procesamiento rápido interactivo |
| Backend | Node.js vanilla | API REST + daemon de ingesta |
| Frontend | Vanilla JS + D3.js | Grafo egocéntrico, sin frameworks |

## Quick Start

```bash
cat docs/local-deploy.md        # Instrucciones completas

# Resumen rápido:
docker compose up -d             # Levanta Apache AGE
npm install                      # Dependencias
./start.sh                       # O manualmente:
node backend/api.js              # http://localhost:3000
```

## Arquitectura

```
[RSS Feeds] --> rss_fetcher.js --> /data/raw_news/*.json
                                        |
                                   ingest.js + Ollama
                                        |
                                  .extraction.json (cache)
                                        |
                                   Apache AGE (grafo)
                                        |
                                     api.js
                                        |
                                   frontend (D3.js)
```

## Estructura

```
/lombardi
├── backend/
│   ├── api.js              # Servidor HTTP + API REST
│   ├── ingest.js           # Daemon: Ollama → grafo
│   ├── rss_fetcher.js      # Descarga RSS a JSON
│   ├── extractor.js        # Prompt de extracción ontológica
│   ├── resolver.js         # Detector de contradicciones
│   └── seed.js             # Grafo de conocimiento base
├── frontend/
│   ├── index.html          # UI principal
│   ├── app.js              # Motor D3.js egocéntrico
│   ├── i18n.js             # ES/EN
│   └── css/                # variables, layout, graph, detail
├── data/
│   ├── schema.json         # Ontología (fuente de verdad)
│   ├── aliases.json        # Normalización de entidades
│   ├── seed-knowledge.json # Grafo base
│   ├── sources/feeds.json   # Feeds RSS configurables
│   ├── sources/topics.json  # Temas de interés
│   └── raw_news/           # Noticias crudas + extracciones
├── docs/
│   └── local-deploy.md
├── docker-compose.yml
├── backlog.md
└── package.json
```

## Ontología

Definida en [`data/schema.json`](data/schema.json):

**Nodos:** Actor (Person, Organization, Location, Object), Evento
**Aristas:** PARTICIPA, CAUSA, CONTRADICE, COMPLEMENTA, DESMIENTE, ACTUALIZA, UBICADO_EN, PERTENECE_A
**17 tipos de evento:** desde CAMBIO_LIDERAZGO hasta EVENTO_GENERICO

## Interfaz

- **Vista Nodes:** Grafo de fuerza con colores por tipo
- **Vista Titles:** Tipografía serif como nodos, collision de bounding box
- **Panel de detalle:** Tipo editable, descripción, aliases, merge, noticias vinculadas, Wikidata
- **Breadcrumbs semánticos:** Aristas entre nodos navegados
- **Buscador:** Autocompletado con dot de color
- **i18n:** ES/EN con browser detect
- **Tema claro/oscuro**

## Documentación

- [`docs/local-deploy.md`](docs/local-deploy.md) — Instalación local
- [`backlog.md`](backlog.md) — Roadmap
- [`data/schema.json`](data/schema.json) — Ontología auditable

## Licencia

ISC
