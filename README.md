# OverStand (OS)

> *A diferencia de Understand (entender desde abajo) o Outstand (sobresalir), **OverStand** es una posicion cognitiva de dominio: estar encima de la informacion para ver la totalidad de la trama sin ser absorbido por el ruido.*

## El Concepto

En la cultura Rastafari se rechaza "Understand" porque implica sumision: estar *debajo* para conocer. **OverStand** propone elevacion: alcanzar una comprension donde el sujeto no es dominado por la informacion, sino que la domina desde una perspectiva soberana.

**Geometria del conocimiento:**
- **Understand** (debajo): ver los cimientos, arriesgarse a ser aplastado por la estructura
- **Outstand** (fuera): sobresalir, pero quedar aislado de la trama
- **OverStand** (encima): estar en el vertice, ver la totalidad de la red, los flujos y las tensiones

El sistema opera bajo la premisa de que la realidad es un fluido. OverStand es la capacidad de estar en la superficie (la interfaz) viendo simultaneamente lo que ocurre en las profundidades (los datos raw) y como se propagan las ondas (las consecuencias).

## Que hace

- Ingiere noticias de 31 feeds RSS internacionales (BBC, TASS, Al Jazeera, China Daily, Breitbart, Le Monde...)
- Extrae entidades, afirmaciones y relaciones usando LLMs locales (Ollama)
- Construye un grafo de conocimiento en Apache AGE (PostgreSQL + Cypher)
- Visualiza un **egosistema de nodo** navegable: foco din&aacute;mico con 2 grados de separaci&oacute;n
- Enriquece nodos desde Wikidata con un click
- Permite editar tipos, aliases y fusionar nodos desde la interfaz

## Stack

| Capa | Tecnolog&iacute;a | Rol |
|:---|:---|:---|
| Base de datos | Apache AGE (Docker) | Grafo + SQL h&iacute;brido |
| IA local | Ollama (nativo) | Extracci&oacute;n ontol&oacute;gica con llama3.1 |
| Backend | Node.js vanilla | API REST + daemon de ingesta |
| Frontend | Vanilla JS + D3.js | Grafo egoc&eacute;ntrico, sin frameworks |

## Quick Start

```bash
# Ver instrucciones completas de instalaci&oacute;n
cat docs/local-deploy.md

# Resumen r&aacute;pido:
docker compose up -d          # Levanta Apache AGE
npm install                    # Dependencias
node backend/seed.js           # Carga grafo de conocimiento base
node backend/rss_fetcher.js    # Descarga noticias
node backend/ingest.js         # Procesa con Ollama
node backend/api.js            # Abre http://localhost:3000
```

## Arquitectura

```
[RSS Feeds] --> rss_fetcher.js --> /data/raw_news/*.json
                                        |
                                   ingest.js + Ollama
                                        |
                                  .extraction.json (persistente)
                                        |
                                   Apache AGE (grafo)
                                        |
                                     api.js
                                        |
                                   frontend (D3.js)
```

## Estructura del proyecto

```
/OverStand
├── backend/
│   ├── api.js              # Servidor HTTP + API REST
│   ├── ingest.js           # Daemon: Ollama extraccion -> grafo
│   ├── ingest-runner.sh    # Wrapper resiliente para ingesta continua
│   ├── rss_fetcher.js      # Descarga RSS a JSON
│   └── seed.js             # Carga grafo de conocimiento base
├── frontend/
│   ├── index.html          # UI principal
│   ├── app.js              # Motor D3.js egoc&eacute;ntrico
│   ├── i18n.js             # Traducciones ES/EN
│   └── css/
│       ├── variables.css   # Tokens sem&aacute;nticos
│       ├── layout.css      # Shell, header, split-view
│       ├── graph.css       # Animaciones del grafo
│       └── detail.css      # Panel de detalle
├── data/
│   ├── schema.json         # Ontolog&iacute;a (fuente de verdad)
│   ├── aliases.json        # Normalizaci&oacute;n de entidades
│   ├── seed-knowledge.json # Grafo base de sentido com&uacute;n
│   ├── sources/feeds.csv   # 31 feeds RSS curados
│   └── raw_news/           # Noticias crudas + extracciones
├── docs/
│   └── local-deploy.md     # Gu&iacute;a de instalaci&oacute;n local
├── docker-compose.yml
├── backlog.md
└── package.json
```

## Ontolog&iacute;a

Definida en `data/schema.json`:

**Nodos:** Actor, Evento, Afirmaci&oacute;n, Noticia
**Aristas:** REPORTA, INVOLUCRA, SOSTIENE, PARTICIPA, UBICADO_EN, PERTENECE_A, CAUSA, CONTRADICE, COMPLEMENTA, DESMIENTE, ACTUALIZA
**17 tipos de evento:** desde CAMBIO_LIDERAZGO hasta EVENTO_GENERICO

## Interfaz

- **Vista Nodes:** Grafo de fuerza con colores por tipo (azul=persona, verde=lugar, naranja=organizaci&oacute;n)
- **Vista Titles:** Tipograf&iacute;a como nodos con collision de bounding box
- **Panel de detalle:** Tipo editable, aliases, merge, delete, noticias vinculadas, enriquecimiento Wikidata
- **Breadcrumbs sem&aacute;nticos:** Muestra la arista entre nodos navegados
- **Buscador:** Autocompletado con dot de color por tipo
- **i18n:** ES/EN con browser detect

## Documentaci&oacute;n

- [`docs/local-deploy.md`](docs/local-deploy.md) — Instalaci&oacute;n y configuraci&oacute;n local
- [`backlog.md`](backlog.md) — Roadmap y estado del proyecto
- [`data/schema.json`](data/schema.json) — Ontolog&iacute;a auditable

## Licencia

ISC
