# Lombardi — Local Deploy

Guia para levantar Lombardi en una Mac con Apple Silicon (M1/M2/M3).

## Requisitos

| Componente | Version minima | Instalacion |
|:---|:---|:---|
| **Node.js** | v20+ | `brew install node` |
| **Docker Desktop** | 4.x | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| **Ollama** | 0.3+ | [ollama.com/download](https://ollama.com/download) |
| **Git** | 2.x | `brew install git` |

**RAM recomendada:** 16GB minimo, 36GB ideal (para correr LLMs de 8B+ en paralelo con AGE).

## 1. Clonar el repositorio

```bash
git clone <repo-url> lombardi
cd lombardi
```

## 2. Instalar dependencias de Node

```bash
npm install
```

Esto instala: `fast-xml-parser`, `csv-parser`, `pg`.

## 3. Levantar Apache AGE (base de datos)

```bash
docker compose up -d
```

Esto inicia un contenedor `os_database` con PostgreSQL + la extension AGE para grafos.

- **Puerto:** 5432
- **Usuario:** os_admin
- **Password:** lombardi_pass
- **Base de datos:** lombardi

Verificar que esta corriendo:

```bash
docker exec os_database pg_isready -U os_admin -d lombardi
```

## 4. Instalar modelo de Ollama

```bash
ollama pull llama3.1
```

Para mejor calidad (pero mas lento):

```bash
ollama pull qwen3.5
```

Verificar que Ollama esta corriendo:

```bash
curl http://localhost:11434/api/tags
```

## 5. Cargar el grafo de conocimiento base (seed)

```bash
node backend/seed.js
```

Esto carga ~50 entidades geopoliticas (presidentes, paises, organizaciones) con sus relaciones base desde `data/seed-knowledge.json`.

## 6. Descargar noticias

```bash
node backend/rss_fetcher.js
```

Lee los 31 feeds RSS de `data/sources/feeds.csv` y guarda los items en `data/raw_news/`.

## 7. Procesar noticias con Ollama

### Opcion A: proceso unico

```bash
node backend/ingest.js
```

### Opcion B: runner resiliente (recomendado)

```bash
bash backend/ingest-runner.sh &
```

El runner reinicia automaticamente si el proceso muere (timeout de 5 min por ciclo). Monitorear con:

```bash
tail -f /tmp/os_ingest.log
```

El procesamiento guarda `.extraction.json` junto a cada noticia para no re-inferir si se reprocesa.

## 8. Iniciar el servidor

```bash
node backend/api.js
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Comandos utiles

```bash
# Estado de Docker
docker compose ps

# Reiniciar base de datos
docker compose restart

# Detener todo
docker compose down

# Ver cuantas noticias hay
ls data/raw_news/*.json | wc -l          # pendientes
ls data/raw_news/.processed/*.json | wc -l  # procesadas

# Consultar el grafo directamente
docker exec os_database psql -U os_admin -d lombardi -c "
LOAD 'age'; SET search_path = ag_catalog, public;
SELECT count(*) FROM cypher('lombardi', \$\$ MATCH (n) RETURN n \$\$) as (v agtype);
"

# Limpiar grafo y reprocesar desde cero
docker exec os_database psql -U os_admin -d lombardi -c "
LOAD 'age'; SET search_path = ag_catalog, public;
SELECT drop_graph('lombardi', true);
SELECT create_graph('lombardi');
TRUNCATE news_raw;
"
mv data/raw_news/.processed/*.json data/raw_news/
rm -f data/raw_news/*.extraction.json
node backend/seed.js
```

## Estructura de datos

```
data/
├── schema.json          # Ontologia (nodos, aristas, tipos de evento, modelos)
├── aliases.json         # Diccionario de normalizacion de entidades
├── seed-knowledge.json  # Grafo base de sentido comun
├── sources/
│   └── feeds.csv        # 31 feeds RSS curados
├── raw_news/
│   ├── *.json           # Noticias crudas (pendientes)
│   ├── *.extraction.json # Output de Ollama (persistente)
│   └── .processed/      # Noticias ya incorporadas al grafo
└── db/                  # Datos de PostgreSQL (volumen Docker)
```

## Configuracion

### Cambiar modelo de extraccion

Editar `data/schema.json`:

```json
"extraction": {
    "models": {
        "extractor": { "model": "llama3.1" }
    }
}
```

### Agregar feeds RSS

Editar `data/sources/feeds.csv` y correr `node backend/rss_fetcher.js`.

### Agregar entidades al seed

Editar `data/seed-knowledge.json` y correr `node backend/seed.js`.

## Puertos

| Servicio | Puerto |
|:---|:---|
| API + Frontend | 3000 |
| PostgreSQL (AGE) | 5432 |
| Ollama | 11434 |

## Troubleshooting

**Ollama se cuelga en una noticia:**
Usa el runner resiliente (`ingest-runner.sh`) que reinicia automaticamente.

**Error "syntax error at or near =":**
Caracteres especiales en el texto. El sistema maneja la mayoria, pero si persiste, el archivo se queda en `raw_news/` para reintentar.

**Docker no arranca:**
Verificar que Docker Desktop este abierto: `open -a Docker`.

**Base de datos sin datos:**
Correr `node backend/seed.js` para cargar el grafo base.
