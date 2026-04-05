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
        'detail.translate': 'Traducir',
        'detail.translating': 'Traduciendo...',
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
        'detail.disputed.hint': 'Ver controversia y deliberar',
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
        'process.title': 'Estado del sistema',
        'process.fetch': 'Buscar RSS nuevos',
        'process.fetching': 'Buscando...',
        'process.console': 'Consola',
        'process.total': 'Total',
        'graph.nodes': 'Nodos',
        'graph.edges': 'Aristas',
        'graph.orphans': 'Huérfanos',
        'graph.degree1': 'Grado 1',
        'graph.noDate': 'Sin fecha',
        'graph.mistyped': 'Mal tipados',
        'graph.sources': 'Fuentes',
        'graph.prune': 'Podar grafo',
        'graph.pruning': 'Podando...',
        'graph.pruned': 'eliminados',
        'graph.fixed': 'corregidos',
        'graph.section': 'Grafo',
        'graph.news': 'Noticias',

        // Reprocess
        'reprocess': 'Reprocesar',
        'reprocess.searching': 'Buscando noticias...',
        'reprocess.searchingLinked': 'Buscando noticias vinculadas...',
        'reprocess.noNews': 'Sin noticias para reprocesar',
        'reprocess.found': 'noticias encontradas',
        'reprocess.processing': 'Procesando',
        'reprocess.updating': 'Actualizando grafo...',
        'reprocess.done': 'noticias reprocesadas',

        // Web search & create
        'searchWeb': 'Buscar noticias sobre',
        'createNode': 'Crear nodo',
        'createNode.title': 'Nuevo nodo',
        'createNode.name': 'Nombre',
        'createNode.lang': 'Idioma',
        'createNode.type': 'Tipo',
        'createNode.create': 'Crear',
        'createNode.cancel': 'Cancelar',
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
        'loading.graph': 'Cargando grafo...',

        // Batch ingestion
        'batch.selected': 'seleccionadas',
        'batch.extract': 'Extraer lote',
        'batch.extracting': 'Extrayendo lote...',
        'batch.review.title': 'Revisión del lote',
        'batch.review.confirmed': 'Confirmados',
        'batch.review.novel': 'Nuevos',
        'batch.review.commit': 'Incorporar al grafo',
        'batch.review.discard': 'Descartar',
        'batch.sources': 'fuentes',
        'batch.fetchingArticles': 'Descargando artículos',
        'batch.minSelection': 'Selecciona al menos 1 noticia',
        'batch.maxSelection': 'Máximo 12 noticias',
        'batch.anchors': 'anclajes',
        'batch.provenance': 'Procedencia',
        'batch.mentions': 'menciones',
        'batch.evidences': 'evidencias',
        'batch.llmWaiting': 'Extracción LLM',
        'batch.llmExtracting': 'Extrayendo con {model}...',
        'batch.llmFallback': 'Claude no disponible, usando Ollama...',

        // Detail extras
        'detail.enriching': 'Enriqueciendo...',
        'detail.enrichBtn': 'Enriquecer',
        'detail.sources': 'Fuentes',
        'detail.delete': 'Eliminar nodo',

        // Relations
        'relations': 'Relaciones',
        'relations.none': 'Sin relaciones',
        'relations.add': 'Agregar relación',
        'relations.target': 'Nodo destino',
        'relations.role': 'Rol (opcional)',
        'relations.edgeType': 'Tipo de relación',
        'relations.save': 'Guardar',
        'relations.cancel': 'Cancelar',

        'noNews': 'Sin noticias',

        // Process panel extras
        'process.graphHealth': 'Salud del grafo',
        'process.actors': 'actores',
        'process.events': 'eventos',
        'process.edges': 'aristas',
        'process.newsProcessed': 'noticias procesadas',
        'process.newsUnprocessed': 'sin procesar',
        'process.sources': 'fuentes',
        'fetchRss': 'Buscar RSS',
        'fetchingRss': 'Buscando...',
        'pruneGraph': 'Podar grafo',
        'pruneWarning': 'Esto eliminará nodos aislados. ¿Continuar?',

        // Loading / errors
        'loading': 'Cargando...',
        'errorLoadingEvents': 'Error al cargar información del evento',

        // Verification / controversies
        'verificationTitle': 'Contradicción',
        'contradictionType': 'Tipo',
        'contradictionType_fact': 'Hecho',
        'contradictionType_actor': 'Actor',
        'contradictionType_attribute': 'Atributo',
        'contradictionType_narrative': 'Narrativa',
        'contradictionType_unknown': 'Desconocido',
        'tensionScore': 'Tensión',
        'detectedBy': 'Detectado por',
        'disputeSummaryLabel': 'En disputa',
        'disputeSummaryMissing': 'El sistema detectó una contradicción entre estos eventos pero no generó una explicación. Revisa las citas de cada versión.',
        'versionA': 'Versión A',
        'versionB': 'Versión B',
        'communityConsensus': 'Consenso comunitario',
        'votes': 'votos',
        'yourPosition': 'Tu posición',
        'positionQuestion': '¿Cuál versión te parece más creíble?',
        'voteSideA': 'Versión A',
        'voteSideB': 'Versión B',
        'voteBothValid': 'Ambas tienen mérito',
        'yourConfidence': 'Tu confianza',
        'evidenceLabel': 'Evidencia o argumento (opcional)',
        'evidencePlaceholder': '¿Por qué te inclinas por esta versión? Incluye fuentes si las tienes...',
        'yourName': 'Tu nombre',
        'namePlaceholder': 'Nombre o apodo',
        'submitVerification': 'Enviar posición',
        'submitting': 'Enviando...',
        'successVerification': '¡Gracias! Tu posición fue registrada.',
        'errorNoName': 'Por favor ingresa tu nombre',
        'errorNoVote': 'Por favor selecciona una versión',
        'errorGeneric': 'Ocurrió un error. Intenta de nuevo.',
        'errorNetwork': 'Error de conexión. Revisa tu red.',
        'noVotesYet': 'Sin votos aún',
        'statusPending': 'Pendiente',
        'statusConfirmed': 'Confirmada',
        'statusDisputed': 'Disputada',
        'statusResolved': 'Resuelta',

        // Discover relations
        'discover.searching': 'Buscando relaciones latentes...',
        'discover.updating': 'Actualizando grafo...',
        'discover.found': 'relaciones descubiertas',
        'discover.none': 'Sin relaciones latentes nuevas',

        // Search
        'search.noResults': 'Sin resultados',

        // Landscape suggestions
        'landscape.title': 'Sugerencias',
        'landscape.containment': 'Contiene',
        'landscape.merge': 'Fusionar',
        'landscape.reparent': 'Reasignar padre',
        'landscape.accept': 'Aceptar',
        'landscape.reject': 'Rechazar',
        'landscape.acceptAll': 'Aceptar todas',
        'landscape.reason': 'Razón',
        'landscape.shared': 'actores en común',
        'landscape.pending': 'pendientes',
        'landscape.noSuggestions': 'Sin sugerencias pendientes',
        'landscape.sweep': 'Analizar',
        'landscape.sweeping': 'Analizando...',
        'landscape.confidence': 'Confianza'
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

        'detail.empty': 'Select a node in the graph to see its detail.',
        'detail.type': 'Type',
        'detail.addDescription': 'Add description...',
        'detail.aliases': 'Aliases',
        'detail.aliases.none': 'No aliases',
        'detail.aliases.add': 'Add alias or another node name...',
        'detail.translate': 'Translate',
        'detail.translating': 'Translating...',
        'detail.enrich': 'Enrich from Wikidata',
        'detail.enriching': 'Enriching...',
        'detail.enrichBtn': 'Enrich',
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
        'detail.disputed.hint': 'View controversy and deliberate',
        'detail.evidence': 'Evidence',
        'detail.event': 'Event',
        'detail.classification': 'Classification',
        'detail.source': 'Source',
        'detail.sources': 'Sources',
        'detail.connections': 'Connections',
        'detail.link': 'Link',
        'detail.status': 'Status',
        'detail.delete': 'Delete node',
        'detail.delete.confirm': 'Are you sure you want to delete this node?',
        'detail.addRelation': 'Add relation',
        'detail.targetNode': 'Node',
        'detail.searchNode': 'Search node...',
        'detail.relationType': 'Type',
        'detail.role': 'Role',
        'detail.selectNode': 'Select a node first',

        // Relations
        'relations': 'Relationships',
        'relations.none': 'No relationships',
        'relations.add': 'Add relationship',
        'relations.target': 'Target node',
        'relations.role': 'Role (optional)',
        'relations.edgeType': 'Relationship type',
        'relations.save': 'Save',
        'relations.cancel': 'Cancel',

        'noNews': 'No news',

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

        'process.title': 'Graph Dashboard',
        'process.graphHealth': 'Graph health',
        'process.actors': 'actors',
        'process.events': 'events',
        'process.edges': 'edges',
        'process.newsProcessed': 'news processed',
        'process.newsUnprocessed': 'unprocessed',
        'process.sources': 'sources',
        'process.fetch': 'Fetch new RSS',
        'process.fetching': 'Fetching...',
        'process.console': 'Console',
        'process.total': 'Total',
        'fetchRss': 'Fetch RSS',
        'fetchingRss': 'Fetching...',
        'pruneGraph': 'Prune graph',
        'pruneWarning': 'This will delete isolated nodes. Continue?',
        'graph.nodes': 'Nodes',
        'graph.edges': 'Edges',
        'graph.orphans': 'Orphans',
        'graph.degree1': 'Degree 1',
        'graph.noDate': 'No date',
        'graph.mistyped': 'Mistyped',
        'graph.sources': 'Sources',
        'graph.prune': 'Prune graph',
        'graph.pruning': 'Pruning...',
        'graph.pruned': 'removed',
        'graph.fixed': 'fixed',
        'graph.section': 'Graph',
        'graph.news': 'News',

        'reprocess': 'Reprocess',
        'reprocess.searching': 'Searching news...',
        'reprocess.searchingLinked': 'Searching linked news...',
        'reprocess.noNews': 'No news to reprocess',
        'reprocess.found': 'news found',
        'reprocess.processing': 'Processing',
        'reprocess.updating': 'Updating graph...',
        'reprocess.done': 'news reprocessed',

        'searchWeb': 'Search news about',
        'createNode': 'Create node',
        'createNode.title': 'New node',
        'createNode.name': 'Name',
        'createNode.lang': 'Language',
        'createNode.type': 'Type',
        'createNode.create': 'Create',
        'createNode.cancel': 'Cancel',
        'searchingWeb': 'Searching news about',
        'noWebResults': 'No news found.',
        'webResults': 'News found for',
        'ingest': 'Ingest',

        'searchRelatedNews': 'Search news',

        'console.title': 'Console',

        'theme.toggle': 'Light/dark theme',

        'loading.graph': 'Loading graph...',
        'loading': 'Loading...',
        'errorLoadingEvents': 'Error loading event information',

        // Verification panel
        'verificationTitle': 'Contradiction',
        'contradictionType': 'Type',
        'contradictionType_fact': 'Fact',
        'contradictionType_actor': 'Actor',
        'contradictionType_attribute': 'Attribute',
        'contradictionType_narrative': 'Narrative',
        'contradictionType_unknown': 'Unknown',
        'tensionScore': 'Tension',
        'detectedBy': 'Detected by',
        'disputeSummaryLabel': 'In dispute',
        'disputeSummaryMissing': 'The system detected a contradiction between these events but did not generate an explanation. Review the quotes from each version.',
        'versionA': 'Version A',
        'versionB': 'Version B',
        'communityConsensus': 'Community consensus',
        'votes': 'votes',
        'yourPosition': 'Your position',
        'positionQuestion': 'Which version do you find more credible?',
        'voteSideA': 'Version A',
        'voteSideB': 'Version B',
        'voteBothValid': 'Both have merit',
        'yourConfidence': 'Your confidence',
        'evidenceLabel': 'Evidence or argument (optional)',
        'evidencePlaceholder': 'Why do you lean this way? Include sources if you have them...',
        'yourName': 'Your name',
        'namePlaceholder': 'Name or nickname',
        'submitVerification': 'Submit position',
        'submitting': 'Submitting...',
        'successVerification': 'Thank you! Your position was recorded.',
        'errorNoName': 'Please enter your name',
        'errorNoVote': 'Please select a version',
        'errorGeneric': 'An error occurred. Please try again.',
        'errorNetwork': 'Connection error. Check your network.',
        'noVotesYet': 'No votes yet',
        'statusPending': 'Pending',
        'statusConfirmed': 'Confirmed',
        'statusDisputed': 'Disputed',
        'statusResolved': 'Resolved',

        // Batch ingestion
        'batch.selected': 'selected',
        'batch.extract': 'Extract batch',
        'batch.extracting': 'Extracting batch...',
        'batch.review.title': 'Batch review',
        'batch.review.confirmed': 'Confirmed',
        'batch.review.novel': 'Novel',
        'batch.review.commit': 'Commit to graph',
        'batch.review.discard': 'Discard',
        'batch.sources': 'sources',
        'batch.fetchingArticles': 'Fetching articles',
        'batch.minSelection': 'Select at least 1 news item',
        'batch.maxSelection': 'Maximum 12 news items',
        'batch.anchors': 'anchors',
        'batch.provenance': 'Provenance',
        'batch.mentions': 'mentions',
        'batch.evidences': 'evidences',
        'batch.llmWaiting': 'LLM extraction',
        'batch.llmExtracting': 'Extracting with {model}...',
        'batch.llmFallback': 'Claude unavailable, using Ollama...',

        // Discover relations
        'discover.searching': 'Searching latent relations...',
        'discover.updating': 'Updating graph...',
        'discover.found': 'relations discovered',
        'discover.none': 'No new latent relations',

        // Search
        'search.noResults': 'No results',

        // Landscape suggestions
        'landscape.title': 'Suggestions',
        'landscape.containment': 'Contains',
        'landscape.merge': 'Merge',
        'landscape.reparent': 'Reparent',
        'landscape.accept': 'Accept',
        'landscape.reject': 'Reject',
        'landscape.acceptAll': 'Accept all',
        'landscape.reason': 'Reason',
        'landscape.shared': 'shared actors',
        'landscape.pending': 'pending',
        'landscape.noSuggestions': 'No pending suggestions',
        'landscape.sweep': 'Analyze',
        'landscape.sweeping': 'Analyzing...',
        'landscape.confidence': 'Confidence'
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
