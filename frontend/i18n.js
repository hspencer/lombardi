const TRANSLATIONS = {
    es: {
        // Header
        'search.placeholder': 'Buscar actor, evento...',
        'lang.label': 'ES',
        'stats.sources': 'fuentes',

        // Detail panel
        'detail.empty': 'Selecciona un nodo en el grafo para ver su detalle.',
        'detail.type': 'Tipo',
        'detail.aliases': 'Aliases',
        'detail.aliases.none': 'Sin aliases',
        'detail.aliases.add': 'Agregar alias o nombre de otro nodo...',
        'detail.enrich': 'Enriquecer desde Wikidata',
        'detail.enrich.loading': 'Consultando Wikidata...',
        'detail.enrich.notfound': 'No se encontró en Wikidata.',
        'detail.enrich.description': 'Descripción:',
        'detail.enrich.relations': 'Relaciones',
        'detail.enrich.apply': 'Aplicar al grafo',
        'detail.enrich.cancel': 'Cancelar',
        'detail.news': 'Noticias',
        'detail.news.none': 'Sin noticias vinculadas.',
        'detail.news.loading': 'Cargando...',
        'detail.disputed': 'Disputado',
        'detail.evidence': 'Evidencia',
        'detail.event': 'Evento',
        'detail.classification': 'Clasificación',
        'detail.source': 'Fuente',
        'detail.connections': 'Conexiones',
        'detail.link': 'Link',
        'detail.status': 'Estado',

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

        // Ingest status
        'ingest.status.pending': 'Pendientes',
        'ingest.status.processed': 'Procesadas',
        'ingest.status.extractions': 'Extracciones',
        'ingest.unprocessed': 'Sin procesar',
        'process.title': 'Procesamiento',
        'process.fetch': 'Buscar RSS nuevos',
        'detail.delete.confirm': '¿Eliminar nodo',
        'tab.node': 'Nodo',
        'tab.feed': 'Noticias',
        'feed.claims': 'afirmaciones'
    },
    en: {
        'search.placeholder': 'Search actor, event...',
        'lang.label': 'EN',
        'stats.sources': 'sources',

        'detail.empty': 'Select a node in the graph to view its details.',
        'detail.type': 'Type',
        'detail.aliases': 'Aliases',
        'detail.aliases.none': 'No aliases',
        'detail.aliases.add': 'Add alias or another node name...',
        'detail.enrich': 'Enrich from Wikidata',
        'detail.enrich.loading': 'Querying Wikidata...',
        'detail.enrich.notfound': 'Not found in Wikidata.',
        'detail.enrich.description': 'Description:',
        'detail.enrich.relations': 'Relations',
        'detail.enrich.apply': 'Apply to graph',
        'detail.enrich.cancel': 'Cancel',
        'detail.news': 'News',
        'detail.news.none': 'No linked news.',
        'detail.news.loading': 'Loading...',
        'detail.disputed': 'Disputed',
        'detail.evidence': 'Evidence',
        'detail.event': 'Event',
        'detail.classification': 'Classification',
        'detail.source': 'Source',
        'detail.connections': 'Connections',
        'detail.link': 'Link',
        'detail.status': 'Status',

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

        'ingest.status.pending': 'Pending',
        'ingest.status.processed': 'Processed',
        'ingest.status.extractions': 'Extractions',
        'ingest.unprocessed': 'Unprocessed',
        'process.title': 'Processing',
        'process.fetch': 'Fetch new RSS',
        'detail.delete.confirm': 'Delete node',
        'tab.node': 'Node',
        'tab.feed': 'News',
        'feed.claims': 'claims'
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
