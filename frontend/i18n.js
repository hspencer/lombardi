const TRANSLATIONS = {
    es: {
        // Header
        'search.placeholder': 'Buscar actor, evento...',
        'lang.label': 'ES',
        'stats.sources': 'fuentes',

        // Toolbar
        'toolbar.nodes': 'Nodos',
        'toolbar.titles': 'Títulos',
        'toolbar.territory': 'Territorio',
        'toolbar.degree': 'Grado',

        // Tabs
        'tab.node': 'Nodo',
        'tab.feed': 'Noticias',
        'tab.sources': 'Fuentes',

        // Sources panel
        'sources.feeds': 'Feeds RSS',
        'sources.topics': 'Temas de interés',
        'sources.addFeed': 'Agregar fuente',
        'sources.feedName': 'Nombre del medio',
        'sources.feedUrl': 'URL del feed RSS',
        'sources.add': 'Agregar',
        'sources.cancel': 'Cancelar',
        'sources.feedLang': 'Idioma (en, es...)',
        'sources.feedRegion': 'Región (US / global...)',
        'sources.addTopic': 'Agregar tema...',
        'sources.topicsHint': 'Solo se descargarán noticias que mencionen estos temas. Sin temas = todo.',
        'sources.enabled': 'habilitadas',
        'sources.noTopics': 'Sin filtro de temas (se descarga todo)',

        // Feed
        'feed.claims': 'afirmaciones',
        'feed.sort.date': 'Recientes',
        'feed.sort.relevance': 'Relevancia',
        'feed.loadMore': 'Cargar más',
        'feed.actors': 'actores',

        // Detail panel
        'detail.empty': 'Selecciona un nodo en el grafo para ver su detalle.',
        'detail.type': 'Tipo',
        'detail.addDescription': 'Agregar descripción...',
        'detail.aliases': 'Aliases',
        'detail.aliases.none': 'Sin aliases',
        'detail.aliases.add': 'Agregar alias o nombre de otro nodo...',
        'detail.enrich': 'Enriquecer desde Wikidata',
        'detail.enrich.loading': 'Consultando Wikidata...',
        'detail.enrich.notfound': 'No se encontró en Wikidata.',
        'detail.enrich.description': 'Descripción:',
        'detail.enrich.relations': 'Relaciones',
        'detail.enrich.apply': 'Aplicar al grafo',
        'detail.enrich.applying': 'Aplicando...',
        'detail.enrich.cancel': 'Cancelar',
        'detail.news': 'Noticias',
        'detail.news.none': 'Sin noticias vinculadas.',
        'detail.news.loading': 'Cargando...',
        'detail.news.openSource': 'Abrir fuente original',
        'detail.disputed': 'Disputado',
        'detail.evidence': 'Evidencia',
        'detail.event': 'Evento',
        'detail.classification': 'Clasificación',
        'detail.source': 'Fuente',
        'detail.connections': 'Conexiones',
        'detail.link': 'Link',
        'detail.status': 'Estado',
        'detail.delete.confirm': '¿Eliminar nodo',
        'detail.addRelation': 'Agregar relación',
        'detail.targetNode': 'Nodo',
        'detail.searchNode': 'Buscar nodo...',
        'detail.relationType': 'Tipo',
        'detail.role': 'Rol',
        'detail.selectNode': 'Selecciona un nodo primero',

        // Ingest
        'ingest.pending': 'pendientes',
        'ingest.hint': 'noticias en el corpus mencionan este nodo pero no se han procesado aún.',
        'ingest.process': 'Procesar noticias relacionadas',
        'ingest.processing': 'Procesando...',
        'ingest.queued': 'noticias en cola de procesamiento.',

        // Merge
        'merge.warning': 'coincide con el nodo',
        'merge.canonical': 'Nombre canónico:',
        'merge.type': 'Tipo:',
        'merge.confirm': 'Fusionar',
        'merge.cancel': 'Cancelar',

        // Ingest status
        'ingest.status.pending': 'Pendientes',
        'ingest.status.processed': 'Procesadas',
        'ingest.status.extractions': 'Extracciones',
        'ingest.unprocessed': 'Sin procesar',

        // Process panel
        'process.title': 'Procesamiento',
        'process.fetch': 'Buscar RSS nuevos',
        'process.fetching': 'Buscando...',
        'process.console': 'Consola',
        'process.total': 'Total',

        // Reprocess
        'reprocess': 'Reprocesar',
        'reprocess.searching': 'Buscando noticias...',
        'reprocess.searchingLinked': 'Buscando noticias vinculadas...',
        'reprocess.noNews': 'Sin noticias para reprocesar',
        'reprocess.found': 'noticias encontradas',
        'reprocess.processing': 'Procesando',
        'reprocess.updating': 'Actualizando grafo...',
        'reprocess.done': 'noticias reprocesadas',

        // Web search
        'searchWeb': 'Buscar noticias sobre',
        'searchingWeb': 'Buscando noticias sobre',
        'noWebResults': 'No se encontraron noticias.',
        'webResults': 'Noticias encontradas para',
        'ingest': 'Ingestar',

        // Node actions
        'searchRelatedNews': 'Buscar noticias',

        // Console
        'console.title': 'Consola',

        // Theme
        'theme.toggle': 'Tema claro/oscuro',

        // Error / loading
        'loading.graph': 'Cargando grafo...'
    },
    en: {
        'search.placeholder': 'Search actor, event...',
        'lang.label': 'EN',
        'stats.sources': 'sources',

        'toolbar.nodes': 'Nodes',
        'toolbar.titles': 'Titles',
        'toolbar.territory': 'Territory',
        'toolbar.degree': 'Degree',

        'tab.node': 'Node',
        'tab.feed': 'News',
        'tab.sources': 'Sources',

        'sources.feeds': 'RSS Feeds',
        'sources.topics': 'Topics of Interest',
        'sources.addFeed': 'Add source',
        'sources.feedName': 'Outlet name',
        'sources.feedUrl': 'RSS feed URL',
        'sources.add': 'Add',
        'sources.cancel': 'Cancel',
        'sources.feedLang': 'Language (en, es...)',
        'sources.feedRegion': 'Region (US / global...)',
        'sources.addTopic': 'Add topic...',
        'sources.topicsHint': 'Only news mentioning these topics will be downloaded. No topics = everything.',
        'sources.enabled': 'enabled',
        'sources.noTopics': 'No topic filter (downloading everything)',

        'feed.claims': 'claims',
        'feed.sort.date': 'Recent',
        'feed.sort.relevance': 'Relevance',
        'feed.loadMore': 'Load more',
        'feed.actors': 'actors',

        'detail.empty': 'Select a node in the graph to view its details.',
        'detail.type': 'Type',
        'detail.addDescription': 'Add description...',
        'detail.aliases': 'Aliases',
        'detail.aliases.none': 'No aliases',
        'detail.aliases.add': 'Add alias or another node name...',
        'detail.enrich': 'Enrich from Wikidata',
        'detail.enrich.loading': 'Querying Wikidata...',
        'detail.enrich.notfound': 'Not found in Wikidata.',
        'detail.enrich.description': 'Description:',
        'detail.enrich.relations': 'Relations',
        'detail.enrich.apply': 'Apply to graph',
        'detail.enrich.applying': 'Applying...',
        'detail.enrich.cancel': 'Cancel',
        'detail.news': 'News',
        'detail.news.none': 'No linked news.',
        'detail.news.loading': 'Loading...',
        'detail.news.openSource': 'Open original source',
        'detail.disputed': 'Disputed',
        'detail.evidence': 'Evidence',
        'detail.event': 'Event',
        'detail.classification': 'Classification',
        'detail.source': 'Source',
        'detail.connections': 'Connections',
        'detail.link': 'Link',
        'detail.status': 'Status',
        'detail.delete.confirm': 'Delete node',
        'detail.addRelation': 'Add relation',
        'detail.targetNode': 'Node',
        'detail.searchNode': 'Search node...',
        'detail.relationType': 'Type',
        'detail.role': 'Role',
        'detail.selectNode': 'Select a node first',

        'ingest.pending': 'pending',
        'ingest.hint': 'news in the corpus mention this node but have not been processed yet.',
        'ingest.process': 'Process related news',
        'ingest.processing': 'Processing...',
        'ingest.queued': 'news queued for processing.',

        'merge.warning': 'matches the node',
        'merge.canonical': 'Canonical name:',
        'merge.type': 'Type:',
        'merge.confirm': 'Merge',
        'merge.cancel': 'Cancel',

        'ingest.status.pending': 'Pending',
        'ingest.status.processed': 'Processed',
        'ingest.status.extractions': 'Extractions',
        'ingest.unprocessed': 'Unprocessed',

        'process.title': 'Processing',
        'process.fetch': 'Fetch new RSS',
        'process.fetching': 'Fetching...',
        'process.console': 'Console',
        'process.total': 'Total',

        'reprocess': 'Reprocess',
        'reprocess.searching': 'Searching news...',
        'reprocess.searchingLinked': 'Searching linked news...',
        'reprocess.noNews': 'No news to reprocess',
        'reprocess.found': 'news found',
        'reprocess.processing': 'Processing',
        'reprocess.updating': 'Updating graph...',
        'reprocess.done': 'news reprocessed',

        'searchWeb': 'Search news about',
        'searchingWeb': 'Searching news about',
        'noWebResults': 'No news found.',
        'webResults': 'News found for',
        'ingest': 'Ingest',

        'searchRelatedNews': 'Search news',

        'console.title': 'Console',

        'theme.toggle': 'Light/dark theme',

        'loading.graph': 'Loading graph...'
    }
};

// Schema-driven i18n bridge
let _schemaData = null;

function setSchemaData(schema) {
    _schemaData = schema;
}

let currentLang = 'es';

function detectLang() {
    const browserLang = (navigator.language || navigator.userLanguage || 'en').slice(0, 2).toLowerCase();
    const saved = localStorage.getItem('os-lang');
    return saved || (browserLang === 'es' ? 'es' : 'en');
}

function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('os-lang', lang);
    document.documentElement.lang = lang;
}

function t(key) {
    return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS.en?.[key] || key;
}

function tType(type) {
    // Read from schema type_labels (Actor node has type_labels for Person, Organization, etc.)
    const labels = _schemaData?.graph?.nodes?.Actor?.type_labels?.[type];
    if (labels) return labels[currentLang] || labels.es || type;
    // Evento node label
    if (type === 'Event' || type === 'Evento') {
        return _schemaData?.graph?.nodes?.Evento?.i18n?.[currentLang]?.label
            || _schemaData?.graph?.nodes?.Evento?.i18n?.es?.label
            || type;
    }
    return type;
}

function tEdge(type) {
    return _schemaData?.graph?.edges?.[type]?.i18n?.[currentLang]?.label
        || _schemaData?.graph?.edges?.[type]?.i18n?.es?.label
        || type.replace(/_/g, ' ');
}

function tEventType(id) {
    if (!_schemaData?.event_types) return id.replace(/_/g, ' ').toLowerCase();
    const et = _schemaData.event_types.find(e => e.id === id);
    if (!et) return id.replace(/_/g, ' ').toLowerCase();
    if (currentLang === 'es') return et.label;
    return et.i18n?.[currentLang] || et.label;
}
