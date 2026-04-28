let charts = {};
let currentData = null;

// DOM Elements
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const btnAnalyze = document.getElementById('btn-analyze');
const btnFixBias = document.getElementById('btn-fix-bias');
const loadingOverlay = document.getElementById('loading-overlay');
const alertContainer = document.getElementById('alert-container');
const btnSimulate = document.getElementById('btn-simulate');

// Event Listeners for Drag & Drop
uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect();
    }
});
fileInput.addEventListener('change', handleFileSelect);

function handleFileSelect() {
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        uploadArea.innerHTML = `<i class="fas fa-file-csv fa-3x"></i><p class="highlight">${file.name}</p>`;
    }
}

function showAlert(message, type = 'warning') {
    const alertId = Date.now();
    const alertHTML = `
        <div class="alert alert-${type}" id="alert-${alertId}">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'times-circle' : 'exclamation-triangle'}"></i>
            <span>${message}</span>
        </div>
    `;
    alertContainer.innerHTML = alertHTML;
    setTimeout(() => {
        const el = document.getElementById(`alert-${alertId}`);
        if(el) el.remove();
    }, 5000);
}

function showLoading(text = 'Analyzing Bias...') {
    loadingOverlay.querySelector('p').innerText = text;
    loadingOverlay.classList.add('active');
}

function hideLoading() {
    loadingOverlay.classList.remove('active');
}

btnAnalyze.addEventListener('click', async () => {
    if (!fileInput.files.length) {
        return showAlert('Please upload a dataset first!', 'danger');
    }
    const targetCol = document.getElementById('target-col').value.trim();
    if (!targetCol) {
        return showAlert('Please specify a target column!', 'warning');
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('target', targetCol);

    showLoading('Detecting Sensitive Features...');

    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Server error');
        
        currentData = data;
        updateDashboard(data);
        
        if (data.score < 80) {
            showAlert('High bias detected! Recommend using One-Click Fix.', 'danger');
            btnFixBias.style.display = 'inline-flex';
        } else {
            showAlert('Model is reasonably fair.', 'success');
            btnFixBias.style.display = 'none';
        }

    } catch (err) {
        showAlert(err.message, 'danger');
    } finally {
        hideLoading();
    }
});

btnFixBias.addEventListener('click', async () => {
    if (!fileInput.files.length || !currentData) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('target', document.getElementById('target-col').value.trim());
    formData.append('fix', 'true');

    showLoading('Applying Mitigation...');

    try {
        const res = await fetch('/api/fix-bias', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Server error');
        
        updateDashboard(data, true);
        showAlert('Bias successfully mitigated using reweighting & omission.', 'success');
        btnFixBias.style.display = 'none';
        
    } catch (err) {
        showAlert(err.message, 'danger');
    } finally {
        hideLoading();
    }
});

function updateDashboard(data, isFixed = false) {
    // 1. Update sensitive features list
    const featuresContainer = document.getElementById('detected-features-container');
    const featuresList = document.getElementById('sensitive-features-list');
    
    if (data.sensitive_cols && data.sensitive_cols.length > 0) {
        featuresContainer.style.display = 'block';
        featuresList.innerHTML = data.sensitive_cols.map(c => `<li>${c}</li>`).join('');
    }

    // 2. Update Metrics
    const accText = document.getElementById('acc-text');
    accText.innerText = (data.accuracy * 100).toFixed(1);
    
    const diText = document.getElementById('di-text');
    diText.innerText = data.disparate_impact.toFixed(2);

    // Update circular score
    const scoreVal = Math.round(data.score);
    document.getElementById('score-text').innerText = scoreVal + '%';
    
    const circle = document.getElementById('score-circle');
    circle.style.strokeDasharray = `${scoreVal}, 100`;

    const riskLabel = document.getElementById('risk-level');
    riskLabel.className = 'risk-label';
    if (scoreVal >= 80) {
        riskLabel.innerText = 'Low Risk';
        riskLabel.classList.add('risk-green');
    } else if (scoreVal >= 60) {
        riskLabel.innerText = 'Moderate Risk';
        riskLabel.classList.add('risk-yellow');
    } else {
        riskLabel.innerText = 'High Risk';
        riskLabel.classList.add('risk-red');
    }

    // Populate What-If Dropdown
    const simSelect = document.getElementById('sim-feature');
    simSelect.innerHTML = '<option value="">Select Feature</option>';
    if(data.feature_importances) {
        Object.keys(data.feature_importances).forEach(f => {
            simSelect.innerHTML += `<option value="${f}">${f}</option>`;
        });
    }

    // Update Charts
    updateCharts(data, isFixed);
}

function updateCharts(data, isFixed) {
    // Common chart options
    Chart.defaults.color = '#c5c6c7';
    Chart.defaults.font.family = "'Rajdhani', sans-serif";

    // Tradeoff Chart
    if(charts.tradeoff) charts.tradeoff.destroy();
    const ctxTradeoff = document.getElementById('tradeoff-chart').getContext('2d');
    
    let tradeoffData = [];
    if(isFixed && currentData) {
        tradeoffData = [
            { x: currentData.score, y: currentData.accuracy * 100, r: 15, label: 'Before' },
            { x: data.score, y: data.accuracy * 100, r: 15, label: 'After (Fixed)' }
        ];
    } else {
        tradeoffData = [{ x: data.score, y: data.accuracy * 100, r: 15, label: 'Current Model' }];
    }

    charts.tradeoff = new Chart(ctxTradeoff, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Model States',
                data: tradeoffData,
                backgroundColor: ['rgba(255, 42, 42, 0.6)', 'rgba(69, 243, 255, 0.6)'],
                borderColor: ['var(--neon-red)', 'var(--neon-blue)'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Fairness Score (%)' }, min: 0, max: 100 },
                y: { title: { display: true, text: 'Accuracy (%)' }, min: 0, max: 100 }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.raw.label}: Fairness ${ctx.raw.x}%, Acc ${ctx.raw.y.toFixed(1)}%`
                    }
                }
            }
        }
    });

    // Feature Importance Chart (Heatmap alternative)
    if(charts.heatmap) charts.heatmap.destroy();
    const ctxHeatmap = document.getElementById('heatmap-chart').getContext('2d');
    
    if(data.feature_importances) {
        const labels = Object.keys(data.feature_importances).slice(0, 10);
        const vals = Object.values(data.feature_importances).slice(0, 10);
        
        charts.heatmap = new Chart(ctxHeatmap, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Importance',
                    data: vals,
                    backgroundColor: 'rgba(181, 43, 250, 0.6)',
                    borderColor: 'var(--neon-purple)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                indexAxis: 'y'
            }
        });
    }

    // Dynamic Tracking Chart
    if(charts.tracking) charts.tracking.destroy();
    const ctxTracking = document.getElementById('tracking-chart').getContext('2d');
    
    const trackingLabels = isFixed ? ['Initial', 'Current'] : ['Initial'];
    const trackingScores = isFixed ? [currentData.score, data.score] : [data.score];
    
    charts.tracking = new Chart(ctxTracking, {
        type: 'line',
        data: {
            labels: trackingLabels,
            datasets: [{
                label: 'Bias Score Trend',
                data: trackingScores,
                borderColor: 'var(--neon-blue)',
                backgroundColor: 'rgba(69, 243, 255, 0.1)',
                borderWidth: 3,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { min: 0, max: 100 } }
        }
    });
}

// Simulator functionality
const simSlider = document.getElementById('sim-factor');
const simVal = document.getElementById('sim-val');

simSlider.addEventListener('input', (e) => {
    simVal.innerText = (e.target.value > 0 ? '+' : '') + e.target.value + '%';
});

btnSimulate.addEventListener('click', async () => {
    if (!currentData) return showAlert('Analyze a model first.', 'warning');
    const feature = document.getElementById('sim-feature').value;
    if (!feature) return showAlert('Select a feature to simulate.', 'warning');
    
    const factor = simSlider.value;
    showLoading('Simulating What-If scenario...');
    
    try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('target', document.getElementById('target-col').value.trim());
        formData.append('feature', feature);
        formData.append('factor', factor);

        const res = await fetch('/api/simulate', { method: 'POST', body: formData });
        const data = await res.json();
        
        document.getElementById('sim-result').style.display = 'block';
        document.getElementById('sim-new-score').innerText = Math.round(data.score) + '%';
        
    } catch (err) {
        showAlert('Simulation failed.', 'danger');
    } finally {
        hideLoading();
    }
});

// Modals
const modal = document.getElementById('scenario-modal');
document.getElementById('btn-real-world').onclick = () => modal.style.display = 'flex';
document.getElementById('close-modal').onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; };

document.querySelectorAll('.scenario-card').forEach(card => {
    card.onclick = () => {
        showAlert(`Loaded pre-sets for ${card.dataset.scenario} scenario.`, 'success');
        modal.style.display = 'none';
    };
});
