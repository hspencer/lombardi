/**
 * Módulo de Verificación de Contradicciones
 * Fase 1: Verificación básica sin autenticación
 */

let currentEdge = null;

/**
 * Inicializar listeners para clicks en aristas
 */
function initVerification() {
    // Este será llamado desde app.js después de renderizar el grafo
    console.log('Verification module initialized');
}

/**
 * Mostrar panel de verificación para una arista CONTRADICE
 */
async function showEdgeVerification(edge) {
    if (edge.type !== 'CONTRADICE') {
        return; // Solo para contradicciones
    }

    currentEdge = edge;

    // Cambiar al tab de Node
    switchRightTab('node');

    // Renderizar panel con loading
    const detailContent = document.getElementById('detailContent');
    const detailBody = document.getElementById('detailBody');
    const empty = document.querySelector('.detail-empty');

    empty.hidden = true;
    detailContent.hidden = false;

    detailBody.innerHTML = `<div style="padding: 40px; text-align: center;"><p>${t('loading')}</p></div>`;

    // Obtener información completa de ambos eventos
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;

    try {
        const [sourceData, targetData] = await Promise.all([
            fetchNodeData(sourceId),
            fetchNodeData(targetId)
        ]);

        // Guardar datos completos en el edge
        edge._sourceData = sourceData;
        edge._targetData = targetData;

        // Renderizar panel con información completa
        detailBody.innerHTML = renderVerificationPanel(edge);

        // Inicializar listeners
        attachVerificationListeners();
    } catch (err) {
        console.error('Error loading event data:', err);
        detailBody.innerHTML = `<div style="padding: 20px;"><p style="color: var(--tension-conflicto);">${t('errorLoadingEvents')}</p></div>`;
    }
}

/**
 * Obtener datos completos de un nodo desde el backend
 */
async function fetchNodeData(nodeId) {
    const response = await fetch(`/api/node?id=${encodeURIComponent(nodeId)}`);
    if (!response.ok) throw new Error('Node not found');
    return response.json();
}

/**
 * Renderizar HTML del panel de verificación
 */
function renderVerificationPanel(edge) {
    const {
        source,
        target,
        tension_score = 0,
        contradiction_type = 'unknown',
        analysis = '',
        detected_by = 'system',
        detected_at = '',
        verification_status = 'pending',
        consensus_score = 0,
        vote_agree_count = 0,
        vote_disagree_count = 0,
        vote_uncertain_count = 0,
        _sourceData,
        _targetData
    } = edge;

    const totalVotes = vote_agree_count + vote_disagree_count + vote_uncertain_count;
    const statusLabel = getStatusLabel(verification_status);
    const statusColor = getStatusColor(verification_status);

    // Renderizar evento con información completa si está disponible
    const renderEvent = (data, fallbackId) => {
        if (!data) {
            return `<strong>${fallbackId}</strong>`;
        }

        const nombre = data.nombre || data.name || fallbackId;
        const descripcion = data.descripcion || data.description || '';
        const fecha = data.fecha || data.date || '';
        const quote = data.evidence_quote || data.quote || '';

        return `
            <div class="event-title">${nombre}</div>
            ${descripcion ? `<div class="event-desc">${descripcion}</div>` : ''}
            ${fecha ? `<div class="event-date">${fecha}</div>` : ''}
            ${quote ? `<div class="event-quote">"${quote}"</div>` : ''}
        `;
    };

    return `
        <div class="verification-panel">
            <div class="verification-header">
                <h3>${t('verificationTitle')}</h3>
                <span class="verification-status" style="background: ${statusColor}">${statusLabel}</span>
            </div>

            <div class="verification-events">
                <div class="verification-event">
                    ${renderEvent(_sourceData, source)}
                </div>
                <div class="verification-vs">vs</div>
                <div class="verification-event">
                    ${renderEvent(_targetData, target)}
                </div>
            </div>

            <div class="verification-metadata">
                <div class="metadata-row">
                    <span class="metadata-label">${t('contradictionType')}:</span>
                    <span class="metadata-value">${t('contradictionType_' + contradiction_type)}</span>
                </div>
                <div class="metadata-row">
                    <span class="metadata-label">${t('tensionScore')}:</span>
                    <span class="metadata-value">
                        ${renderProgressBar(tension_score, '#E74C3C')} ${(tension_score * 100).toFixed(0)}%
                    </span>
                </div>
                <div class="metadata-row">
                    <span class="metadata-label">${t('detectedBy')}:</span>
                    <span class="metadata-value">${detected_by}</span>
                </div>
            </div>

            ${analysis ? `
            <div class="verification-analysis">
                <strong>${t('analysisLabel')}:</strong>
                <p>${analysis}</p>
            </div>
            ` : ''}

            <div class="verification-consensus">
                <div class="consensus-header">
                    <strong>${t('communityConsensus')}</strong>
                    <span>${totalVotes} ${t('votes')}</span>
                </div>
                <div class="consensus-bar">
                    ${renderConsensusBar(vote_agree_count, vote_disagree_count, vote_uncertain_count)}
                </div>
                <div class="consensus-score">
                    ${renderProgressBar(consensus_score, '#27AE60')} ${(consensus_score * 100).toFixed(0)}% ${t('agreeLabel')}
                </div>
            </div>

            <div class="verification-form">
                <h4>${t('yourVerification')}</h4>
                <div class="verification-question">
                    <p>${t('verificationQuestion')}</p>
                    <div class="vote-buttons">
                        <button class="vote-btn vote-agree" data-vote="agree">
                            ✓ ${t('voteAgree')}
                        </button>
                        <button class="vote-btn vote-disagree" data-vote="disagree">
                            ✗ ${t('voteDisagree')}
                        </button>
                        <button class="vote-btn vote-uncertain" data-vote="uncertain">
                            ? ${t('voteUncertain')}
                        </button>
                    </div>
                </div>

                <div class="verification-confidence">
                    <label for="confidenceSlider">${t('yourConfidence')}: <span id="confidenceValue">50</span>%</label>
                    <input type="range" id="confidenceSlider" min="0" max="100" value="50" class="confidence-slider">
                </div>

                <div class="verification-comment">
                    <label for="verificationComment">${t('commentOptional')}:</label>
                    <textarea id="verificationComment" rows="3" placeholder="${t('commentPlaceholder')}"></textarea>
                </div>

                <div class="verification-verifier">
                    <label for="verifierName">${t('yourName')}:</label>
                    <input type="text" id="verifierName" placeholder="${t('namePlaceholder')}" value="${getStoredVerifier()}">
                </div>

                <button id="submitVerification" class="btn-primary" onclick="submitVerification()">
                    ${t('submitVerification')}
                </button>
                <div id="verificationFeedback" class="verification-feedback"></div>
            </div>
        </div>
    `;
}

/**
 * Renderizar barra de progreso
 */
function renderProgressBar(value, color) {
    const pct = Math.round(value * 100);
    return `
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${pct}%; background: ${color}"></div>
        </div>
    `;
}

/**
 * Renderizar barra de consenso con segmentos
 */
function renderConsensusBar(agree, disagree, uncertain) {
    const total = agree + disagree + uncertain;
    if (total === 0) {
        return '<div class="consensus-empty">' + t('noVotesYet') + '</div>';
    }

    const agreePct = (agree / total) * 100;
    const disagreePct = (disagree / total) * 100;
    const uncertainPct = (uncertain / total) * 100;

    return `
        <div class="consensus-segments">
            <div class="segment segment-agree" style="width: ${agreePct}%" title="${agree} ${t('agree')}"></div>
            <div class="segment segment-disagree" style="width: ${disagreePct}%" title="${disagree} ${t('disagree')}"></div>
            <div class="segment segment-uncertain" style="width: ${uncertainPct}%" title="${uncertain} ${t('uncertain')}"></div>
        </div>
        <div class="consensus-legend">
            <span><span class="legend-dot" style="background: #27AE60"></span> ${agree} ${t('agree')}</span>
            <span><span class="legend-dot" style="background: #E74C3C"></span> ${disagree} ${t('disagree')}</span>
            <span><span class="legend-dot" style="background: #95A5A6"></span> ${uncertain} ${t('uncertain')}</span>
        </div>
    `;
}

/**
 * Obtener etiqueta de estado
 */
function getStatusLabel(status) {
    const labels = {
        pending: t('statusPending'),
        confirmed: t('statusConfirmed'),
        disputed: t('statusDisputed'),
        resolved: t('statusResolved')
    };
    return labels[status] || status;
}

/**
 * Obtener color de estado
 */
function getStatusColor(status) {
    const colors = {
        pending: '#F39C12',
        confirmed: '#E74C3C',
        disputed: '#E67E22',
        resolved: '#27AE60'
    };
    return colors[status] || '#95A5A6';
}

/**
 * Adjuntar listeners a elementos del formulario
 */
function attachVerificationListeners() {
    // Actualizar valor del slider
    const slider = document.getElementById('confidenceSlider');
    const valueDisplay = document.getElementById('confidenceValue');
    if (slider && valueDisplay) {
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = e.target.value;
        });
    }

    // Guardar nombre del verificador
    const verifierInput = document.getElementById('verifierName');
    if (verifierInput) {
        verifierInput.addEventListener('change', (e) => {
            localStorage.setItem('verifier_name', e.target.value);
        });
    }
}

/**
 * Obtener nombre del verificador guardado
 */
function getStoredVerifier() {
    return localStorage.getItem('verifier_name') || '';
}

/**
 * Enviar verificación al backend
 */
async function submitVerification() {
    if (!currentEdge) return;

    const verifier = document.getElementById('verifierName').value.trim();
    const confidence = parseFloat(document.getElementById('confidenceSlider').value) / 100;
    const comment = document.getElementById('verificationComment').value.trim();

    // Obtener el voto seleccionado
    const voteButtons = document.querySelectorAll('.vote-btn');
    let vote = null;
    voteButtons.forEach(btn => {
        if (btn.classList.contains('selected')) {
            vote = btn.dataset.vote;
        }
    });

    // Validaciones
    if (!verifier) {
        showVerificationFeedback(t('errorNoName'), 'error');
        return;
    }

    if (!vote) {
        showVerificationFeedback(t('errorNoVote'), 'error');
        return;
    }

    // Deshabilitar botón mientras se envía
    const submitBtn = document.getElementById('submitVerification');
    submitBtn.disabled = true;
    submitBtn.textContent = t('submitting');

    try {
        const response = await fetch(`/api/disputes/${currentEdge.source}/${currentEdge.target}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ verifier, vote, confidence, comment })
        });

        const result = await response.json();

        if (response.ok) {
            showVerificationFeedback(t('successVerification'), 'success');

            // Actualizar el edge actual con los nuevos valores
            Object.assign(currentEdge, {
                vote_agree_count: result.vote_agree_count,
                vote_disagree_count: result.vote_disagree_count,
                vote_uncertain_count: result.vote_uncertain_count,
                consensus_score: result.consensus_score,
                verification_status: result.verification_status
            });

            // Re-renderizar el panel con datos actualizados
            setTimeout(() => {
                showEdgeVerification(currentEdge);
            }, 1500);
        } else {
            showVerificationFeedback(result.error || t('errorGeneric'), 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = t('submitVerification');
        }
    } catch (err) {
        console.error('Error submitting verification:', err);
        showVerificationFeedback(t('errorNetwork'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = t('submitVerification');
    }
}

/**
 * Mostrar feedback de verificación
 */
function showVerificationFeedback(message, type) {
    const feedback = document.getElementById('verificationFeedback');
    if (!feedback) return;

    feedback.textContent = message;
    feedback.className = `verification-feedback ${type}`;
    feedback.style.display = 'block';

    setTimeout(() => {
        feedback.style.display = 'none';
    }, type === 'success' ? 3000 : 5000);
}

/**
 * Toggle selection en vote buttons
 */
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('vote-btn')) {
        // Remover selected de todos
        document.querySelectorAll('.vote-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        // Agregar selected al clickeado
        e.target.classList.add('selected');
    }
});

// Exportar funciones globales
window.initVerification = initVerification;
window.showEdgeVerification = showEdgeVerification;
window.submitVerification = submitVerification;
