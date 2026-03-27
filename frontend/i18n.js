const TRANSLATIONS = {
    es: {
        // Header
        'search.placeholder': 'Buscar actor, evento...',
        'lang.label': 'ES',
        'stats.sources': 'fuentes',

        // Toolbar
        'toolbar.nodes': 'Nodos',
        'toolbar.titles': 'Títulos',
        'toolbar.degree': 'Grado',

        // Tabs
        'tab.node': 'Nodo',
        'tab.feed': 'Noticias',

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

        // Node types
        'type.Person': 'Persona',
        'type.Location': 'Lugar',
        'type.Organization': 'Organización',
        'type.Object': 'Objeto',
        'type.Event': 'Evento',

        // Edge types
        'edge.PARTICIPA': 'Participa',
        'edge.CAUSA': 'Causa',
        'edge.CONTRADICE': 'Contradice',
        'edge.COMPLEMENTA': 'Complementa',
        'edge.PERTENECE_A': 'Pertenece a',
        'edge.UBICADO_EN': 'Ubicado en',
        'edge.RELACIONADO': 'Relacionado',

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
        'toolbar.degree': 'Degree',

        'tab.node': 'Node',
        'tab.feed': 'News',

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

        'type.Person': 'Person',
        'type.Location': 'Location',
        'type.Organization': 'Organization',
        'type.Object': 'Object',
        'type.Event': 'Event',

        'edge.PARTICIPA': 'Participates',
        'edge.CAUSA': 'Causes',
        'edge.CONTRADICE': 'Contradicts',
        'edge.COMPLEMENTA': 'Complements',
        'edge.PERTENECE_A': 'Belongs to',
        'edge.UBICADO_EN': 'Located in',
        'edge.RELACIONADO': 'Related',

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
    return t(`type.${type}`) || type;
}

function tEdge(type) {
    return t(`edge.${type}`) || type.replace(/_/g, ' ');
}
