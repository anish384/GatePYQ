// exam_library.js — Exam Library tree rendering + attempt tracking (GitHub Pages Safe)
(async function () {
    'use strict';

    // ====== State ======
    let indexData = null;
    let attemptMap = {};
    let activeFilter = 'all';
    let searchTerm = '';

    // Multi-Select State
    let isMultiSelectMode = false;
    let selectedExams = new Map();

    // Detect if we're embedded in index.html (has examSection)
    const isEmbedded = !!document.getElementById('examSection');

    // ====== DOM Refs ======
    const contentEl = document.getElementById('libContent');
    const searchInput = document.getElementById('libSearch');
    const statsEl = document.getElementById('libStats');
    const scrollBtn = document.getElementById('scrollTopBtn');

    // Multi-Select DOM Elements
    const multiSelectToggle = document.getElementById('multiSelectToggle');
    const multiSelectFab = document.getElementById('multiSelectFab');
    const fabSelectedCount = document.getElementById('fabSelectedCount');
    const fabAvailableCount = document.getElementById('fabAvailableCount');
    const fabTotalQuestions = document.getElementById('fabTotalQuestions');
    const fabGenerateBtn = document.getElementById('fabGenerateBtn');

    // ====== Environment Detection ======
    const isFileMode = window.location.protocol === 'file:';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // ====== Path Helper for GitHub Pages ======
    // Ensures paths don't start with '/' so they stay within the /GatePYQ/ repo folder
    function getSafeRelativePath(path) {
        if (!path) return '';
        return path.startsWith('/') ? path.substring(1) : path;
    }

    // ====== Init ======
    await loadAttemptData();
    await loadIndex();

    // ====== Load exam index ======
    async function loadIndex() {
        if (contentEl) {
            contentEl.innerHTML = '<div class="lib-loading"><div class="spinner"></div><br>Loading exam library...</div>';
        }

        try {
            if (window.EXAM_INDEX) {
                // 1. Static Index loaded via <script> tag (Safest for GitHub Pages)
                console.log("Loaded index from window.EXAM_INDEX");
                indexData = window.EXAM_INDEX;
            } else if (!isFileMode) {
                // 2. Fetch via relative path for GitHub Pages
                try {
                    console.log("Attempting to fetch exam_index.json natively...");
                    const resp = await fetch('exam_index.json');
                    if (resp.ok) {
                        indexData = await resp.json();
                    } else {
                        throw new Error('exam_index.json not found (Status: ' + resp.status + ')');
                    }
                } catch (err) {
                    // 3. Fallback to Local Node API
                    if (isLocalhost) {
                        console.log("Fallback: Attempting to fetch from local /api/exam-index...");
                        const apiResp = await fetch('/api/exam-index');
                        if (!apiResp.ok) throw new Error('API returned ' + apiResp.status);
                        indexData = await apiResp.json();
                    } else {
                        throw err;
                    }
                }
            } else {
                throw new Error('Running in file:// mode but EXAM_INDEX not found. Include exam_index.js in your HTML.');
            }
            render();
        } catch (e) {
            if (contentEl) {
                contentEl.innerHTML = '<div class="lib-empty">❌ Failed to load exam library.<br><small>Make sure <code>exam_index.json</code> exists and is pushed to GitHub!</small></div>';
            }
            console.error("Exam Library Load Error:", e);
        }
    }

    // ====== Load attempt data from IndexedDB ======
    async function loadAttemptData() {
        try {
            if (typeof initDB === 'function') await initDB();
            if (typeof getExamHistory === 'function') {
                const history = await getExamHistory();
                attemptMap = {};
                history.forEach(exam => {
                    attemptMap[exam.title] = (attemptMap[exam.title] || 0) + 1;
                });
            }
        } catch (e) {
            console.warn('Could not load exam history:', e);
        }
    }

    // ====== Render ======
    function render() {
        if (!contentEl) return;
        if (!indexData || !indexData.sources) {
            contentEl.innerHTML = '<div class="lib-empty">No exam sources found in index.</div>';
            return;
        }

        let filteredSources = indexData.sources;
        if (activeFilter !== 'all') {
            filteredSources = filteredSources.filter(s => s.category === activeFilter);
        }

        if (filteredSources.length === 0) {
            contentEl.innerHTML = '<div class="lib-empty">No sources match the selected filter.</div>';
            updateStats(0, 0);
            return;
        }

        let html = '';
        let totalExams = 0;
        let totalAttempted = 0;

        filteredSources.forEach((source, idx) => {
            const counts = countExams(source.children);
            totalExams += counts.total;
            totalAttempted += counts.attempted;

            const icon = getCategoryIcon(source.category);
            const badgeClass = 'badge-' + source.category;
            const pct = counts.total > 0 ? Math.round((counts.attempted / counts.total) * 100) : 0;

            html += `
                <div class="source-card" data-source-idx="${idx}">
                    <div class="source-header" onclick="toggleSource(this)">
                        <span class="source-chevron">▶</span>
                        <span class="source-icon">${icon}</span>
                        <div class="source-info">
                            <div class="source-name">${source.name}</div>
                            <div class="source-meta">${counts.total} tests · ${counts.attempted} attempted · ${pct}% complete</div>
                        </div>
                        <span class="source-completion-badge ${pct === 100 ? 'complete' : pct > 0 ? 'partial' : ''}">${pct}%</span>
                        <span class="source-badge ${badgeClass}">${formatCategory(source.category)}</span>
                    </div>
                    <div class="source-progress-bar"><div class="source-progress-fill" style="width: ${pct}%"></div></div>
                    <div class="source-body">${renderChildren(source.children, 0)}</div>
                </div>`;
        });

        contentEl.innerHTML = html;
        updateStats(totalExams, totalAttempted);
        updateIndexTimestamp();
        if (searchTerm) applySearch();
    }

    function renderChildren(items, depth) {
        if (!items || items.length === 0) return '';
        let html = '';

        const folders = items.filter(i => i.type === 'folder');
        const exams = items.filter(i => i.type === 'exam');

        exams.forEach(exam => { html += renderExamItem(exam, depth); });

        folders.forEach(folder => {
            if (folder.children.length === 1 && folder.children[0].type === 'exam') {
                html += renderExamItem(folder.children[0], depth);
            } else {
                const childHtml = renderChildren(folder.children, depth + 1);
                const fCounts = countExams(folder.children);
                const fPct = fCounts.total > 0 ? Math.round((fCounts.attempted / fCounts.total) * 100) : 0;
                html += `
                    <div class="tree-folder" data-name="${escapeAttr(folder.name)}">
                        <div class="folder-header" style="padding-left: ${28 + depth * 16}px" onclick="toggleFolder(this)">
                            <span class="folder-chevron">▶</span>
                            <span class="folder-icon">📁</span>
                            <span>${folder.name}</span>
                            <span class="folder-completion ${fPct === 100 ? 'complete' : fPct > 0 ? 'partial' : ''}">${fPct}%</span>
                        </div>
                        <div class="folder-children">${childHtml}</div>
                    </div>`;
            }
        });
        return html;
    }

    function renderExamItem(exam, depth) {
        const attempts = attemptMap[exam.name] || 0;
        const ticksHtml = attempts > 0
            ? '<span class="exam-attempts">' + '✅'.repeat(Math.min(attempts, 5)) +
            (attempts > 5 ? `<span class="exam-meta-tag">×${attempts}</span>` : '') + '</span>'
            : '';

        const qText = exam.questions ? `${exam.questions} Q` : '';
        const dText = exam.duration ? `${exam.duration} min` : '';
        const metaTags = [qText, dText].filter(Boolean).map(t => `<span class="exam-meta-tag">${t}</span>`).join('');

        let actionHtml = '';
        if (isMultiSelectMode) {
            const isChecked = selectedExams.has(exam.file) ? 'checked' : '';
            actionHtml = `<input type="checkbox" class="exam-item-checkbox" value="${escapeAttr(exam.file)}" data-name="${escapeAttr(exam.name)}" data-questions="${exam.questions || 0}" onchange="handleExamSelect(this)" ${isChecked} onclick="event.stopPropagation()">`;
        } else {
            actionHtml = `<button class="exam-start-btn" title="Start this exam">Start ▶</button>`;
        }

        return `
            <div class="exam-item" data-file="${escapeAttr(exam.file)}" data-name="${escapeAttr(exam.name)}" onclick="${isMultiSelectMode ? 'toggleExamCheckbox(this)' : 'launchExam(this)'}" style="padding-left: ${36 + depth * 16}px; ${isMultiSelectMode ? 'cursor: pointer;' : ''}">
                ${actionHtml}
                <span class="exam-item-icon">📝</span>
                <span class="exam-item-name">${exam.name}</span>
                <div class="exam-item-meta">
                    ${metaTags}
                    ${ticksHtml}
                </div>
            </div>`;
    }

    // ====== Multi-Select Logic ======
    window.toggleMultiSelect = function () {
        isMultiSelectMode = !isMultiSelectMode;
        if (multiSelectToggle) {
            if (isMultiSelectMode) {
                multiSelectToggle.classList.add('active');
                multiSelectToggle.innerHTML = '❌ Cancel Multi-Select';
                multiSelectToggle.style.backgroundColor = '#e74c3c';
                multiSelectToggle.style.borderColor = '#c0392b';
                if (multiSelectFab) multiSelectFab.style.display = 'flex';
                selectedExams.clear();
                updateFabUI();
            } else {
                multiSelectToggle.classList.remove('active');
                multiSelectToggle.innerHTML = '✨ Multi-Select Exam';
                multiSelectToggle.style.backgroundColor = 'rgba(155, 89, 182, 0.2)';
                multiSelectToggle.style.borderColor = '#9b59b6';
                if (multiSelectFab) multiSelectFab.style.display = 'none';
                selectedExams.clear();
            }
        }
        render();
    };

    window.toggleExamCheckbox = function (el) {
        if (!isMultiSelectMode) return;
        const checkbox = el.querySelector('.exam-item-checkbox');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            handleExamSelect(checkbox);
        }
    };

    window.handleExamSelect = function (checkbox) {
        if (checkbox.checked) {
            selectedExams.set(checkbox.value, {
                name: checkbox.dataset.name,
                questions: parseInt(checkbox.dataset.questions, 10) || 0
            });
        } else {
            selectedExams.delete(checkbox.value);
        }
        updateFabUI();
    };

    function updateFabUI() {
        if (fabSelectedCount) fabSelectedCount.textContent = `${selectedExams.size} exams selected`;
        let totalAvailableQuestions = 0;
        selectedExams.forEach(data => { totalAvailableQuestions += data.questions; });

        if (fabAvailableCount && fabTotalQuestions) {
            if (selectedExams.size > 0) {
                fabAvailableCount.textContent = `(Max: ${totalAvailableQuestions})`;
                fabAvailableCount.style.display = 'inline';
                fabTotalQuestions.max = totalAvailableQuestions;
                if (parseInt(fabTotalQuestions.value, 10) > totalAvailableQuestions) {
                    fabTotalQuestions.value = totalAvailableQuestions;
                }
            } else {
                fabAvailableCount.style.display = 'none';
                fabTotalQuestions.max = 200;
            }
        }

        if (fabGenerateBtn) {
            fabGenerateBtn.disabled = selectedExams.size === 0;
            fabGenerateBtn.textContent = selectedExams.size === 0 ? 'Select Exams ↑' : 'Generate & Start ▶';
        }
    }

    window.generateCustomExam = async function () {
        if (selectedExams.size === 0) return;
        const totalRequested = parseInt(fabTotalQuestions ? fabTotalQuestions.value : 50, 10);

        if (isNaN(totalRequested) || totalRequested < 1) {
            alert('Please enter a valid number of total questions.');
            return;
        }

        if (fabGenerateBtn) {
            fabGenerateBtn.disabled = true;
            fabGenerateBtn.textContent = 'Generating... \u231B';
        }

        try {
            const rawExamsData = [];
            for (const [file, examMeta] of selectedExams) {
                const data = await fetchExamData(file);
                if (data && data.sections) {
                    rawExamsData.push({ name: examMeta.name, file: file, data });
                }
            }

            if (rawExamsData.length === 0) throw new Error("Could not load any data from selected exams.");

            const customExam = generateMixedExamData(rawExamsData, totalRequested);

            if (isEmbedded) {
                // Start directly on the same page
                startExamDirectly(customExam);
            } else {
                sessionStorage.setItem('retryExamData', JSON.stringify(customExam));
                sessionStorage.setItem('triggerAutoStart', 'true');
                window.location.href = 'index.html';
            }

        } catch (error) {
            console.error(error);
            alert('\u274C Error generating custom exam: ' + error.message);
            if (fabGenerateBtn) {
                fabGenerateBtn.disabled = false;
                fabGenerateBtn.textContent = 'Generate & Start \u25B6';
            }
        }
    };

    // ====== Fetch Exam Data ======
    let _fetchIdCounter = 0;
    function fetchExamData(jsonFile) {
        // Enforce relative path for GitHub Pages compatibility
        const safePath = getSafeRelativePath(jsonFile);

        if (isFileMode) {
            return new Promise((resolve) => {
                const jsFile = safePath.replace(/\.json$/, '_load.js');
                const callbackName = '__examLoadCB_' + (++_fetchIdCounter) + '_' + Date.now();
                let resolved = false;

                window[callbackName] = window.__examLoadCallback = function (examData) {
                    if (resolved) return;
                    resolved = true;
                    delete window[callbackName];
                    resolve(examData);
                };

                const script = document.createElement('script');
                script.src = jsFile;
                script.onload = () => {
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            console.warn(`Timeout loading: ${jsFile}`);
                            resolve(null);
                        }
                    }, 3000);
                };
                script.onerror = () => {
                    if (!resolved) { resolved = true; }
                    console.warn(`Failed to load script: ${jsFile}`);
                    resolve(null);
                };
                document.head.appendChild(script);
            });
        } else {
            console.log(`Fetching exam data from: ${safePath}`);
            return fetch(safePath)
                .then(async r => {
                    if (r.ok) return r.json();
                    if (isLocalhost) {
                        const apiRes = await fetch('/api/exam-data?file=' + encodeURIComponent(jsonFile));
                        if (apiRes.ok) return apiRes.json();
                    }
                    throw new Error(`HTTP ${r.status} fetching ${safePath}`);
                })
                .catch(err => {
                    console.warn('Fetch failed for ' + safePath + ':', err);
                    return null;
                });
        }
    }

    function generateMixedExamData(examsArray, totalRequested) {
        const pools = examsArray.map(examObj => {
            let questions = [];
            examObj.data.sections.forEach(sec => {
                if (sec.questions) questions = questions.concat(sec.questions);
            });
            return { examName: examObj.name, questions: questions };
        });

        const selectedQuestions = [];
        const numExams = pools.length;
        let targetPerExam = Math.floor(totalRequested / numExams);
        let remainder = totalRequested % numExams;

        let distribution = pools.map(() => targetPerExam);
        for (let i = 0; i < remainder; i++) distribution[i % numExams]++;

        let qCounter = 1;
        pools.forEach((pool, index) => {
            let limit = distribution[index];
            const shuffled = [...pool.questions].sort(() => 0.5 - Math.random());
            const taken = shuffled.slice(0, Math.min(limit, shuffled.length));

            taken.forEach(q => {
                q.id = `${qCounter++}`;
                selectedQuestions.push(q);
            });
        });
        selectedQuestions.sort(() => 0.5 - Math.random());

        const finalName = `Custom Mix (${selectedQuestions.length} Qs)`;
        return {
            title: finalName,
            duration: Math.ceil((selectedQuestions.length / 65) * 180) || 30,
            sections: [{ name: "Mixed Section", questions: selectedQuestions }]
        };
    }

    // ====== Helper: Start exam directly (embedded mode) ======
    function startExamDirectly(data) {
        try {
            window.examData = data;
            examData = data;
            if (typeof shuffleExamData === 'function') shuffleExamData();
            if (typeof initializeQuestionStates === 'function') initializeQuestionStates();

            if (window.enterFullScreen) window.enterFullScreen();
            if (typeof toggleHomeView === 'function') toggleHomeView(false);
            document.getElementById('examSection').style.display = 'flex';

            if (typeof startExam === 'function') startExam();
        } catch (e) {
            console.error('Error starting exam directly:', e);
            alert('\u274C Error starting exam: ' + e.message);
        }
    }

    // ====== Launch Exam ======
    window.launchExam = function (el) {
        const jsonFile = el.dataset.file;
        if (!jsonFile) return;

        const btn = el.querySelector('.exam-start-btn');
        if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }

        const safePath = getSafeRelativePath(jsonFile);

        if (isFileMode) {
            const jsFile = safePath.replace(/\.json$/, '_load.js');
            window.__examLoadCallback = function (examLoadedData) {
                delete window.__examLoadCallback;
                if (isEmbedded) {
                    startExamDirectly(examLoadedData);
                } else {
                    try {
                        sessionStorage.setItem('retryExamData', JSON.stringify(examLoadedData));
                        sessionStorage.setItem('triggerAutoStart', 'true');
                        window.location.href = 'index.html';
                    } catch (e) {
                        alert('\u274C Storage Error: ' + e.message);
                        if (btn) { btn.textContent = 'Start \u25B6'; btn.disabled = false; }
                    }
                }
            };
            const script = document.createElement('script');
            script.src = jsFile;
            script.onerror = function () {
                alert('\u274C Could not load exam file: ' + jsFile);
                if (btn) { btn.textContent = 'Start \u25B6'; btn.disabled = false; }
            };
            document.head.appendChild(script);
        } else {
            fetch(safePath)
                .then(async r => {
                    if (r.ok) return r.json();
                    if (isLocalhost) {
                        const apiRes = await fetch('/api/exam-data?file=' + encodeURIComponent(jsonFile));
                        if (apiRes.ok) return apiRes.json();
                    }
                    throw new Error('Failed to fetch ' + safePath);
                })
                .then(examLoadedData => {
                    if (isEmbedded) {
                        startExamDirectly(examLoadedData);
                    } else {
                        sessionStorage.setItem('retryExamData', JSON.stringify(examLoadedData));
                        sessionStorage.setItem('triggerAutoStart', 'true');
                        window.location.href = 'index.html';
                    }
                })
                .catch(e => {
                    alert('\u274C Error loading exam: ' + e.message);
                    if (btn) { btn.textContent = 'Start \u25B6'; btn.disabled = false; }
                });
        }
    };

    window.toggleSource = function (headerEl) { headerEl.parentElement.classList.toggle('open'); };
    window.toggleFolder = function (headerEl) { headerEl.parentElement.classList.toggle('open'); };
    window.setFilter = function (category, btn) {
        activeFilter = category;
        document.querySelectorAll('.lib-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        render();
    };

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            searchTerm = this.value.trim().toLowerCase();
            searchTerm.length === 0 ? render() : applySearch();
        });
    }

    function applySearch() {
        if (!searchTerm) return;
        const allExams = document.querySelectorAll('.exam-item');
        const allFolders = document.querySelectorAll('.tree-folder');
        const allSources = document.querySelectorAll('.source-card');
        let matchCount = 0;

        allExams.forEach(el => el.style.display = 'none');
        allFolders.forEach(el => { el.style.display = 'none'; el.classList.remove('open'); });
        allSources.forEach(el => { el.style.display = 'none'; el.classList.remove('open'); });

        allExams.forEach(el => {
            const name = (el.dataset.name || '').toLowerCase();
            if (name.includes(searchTerm)) {
                el.style.display = '';
                matchCount++;
                let parent = el.parentElement;
                while (parent && parent !== contentEl) {
                    if (parent.classList.contains('tree-folder')) { parent.style.display = ''; parent.classList.add('open'); }
                    if (parent.classList.contains('source-body')) { parent.style.display = ''; }
                    if (parent.classList.contains('source-card')) { parent.style.display = ''; parent.classList.add('open'); }
                    if (parent.classList.contains('folder-children')) { parent.style.display = ''; }
                    parent = parent.parentElement;
                }
            }
        });
        if (statsEl) statsEl.textContent = `${matchCount} result${matchCount !== 1 ? 's' : ''} found`;
    }

    function countExams(items) {
        let total = 0, attempted = 0;
        if (!items) return { total, attempted };
        items.forEach(item => {
            if (item.type === 'exam') {
                total++;
                if (attemptMap[item.name]) attempted++;
            } else if (item.children) {
                const sub = countExams(item.children);
                total += sub.total;
                attempted += sub.attempted;
            }
        });
        return { total, attempted };
    }

    function updateStats(total, attempted) { if (statsEl) statsEl.textContent = `${total} tests · ${attempted} attempted`; }
    function updateIndexTimestamp() { /* Stripped for brevity */ }
    function getCategoryIcon(cat) { return { pyq: '📜', test_series: '📋', subject: '📚', practice: '🔄', other: '📦' }[cat] || '📦'; }
    function formatCategory(cat) { return { pyq: 'PYQ', test_series: 'Test Series', subject: 'Subject', practice: 'Practice', other: 'Other' }[cat] || cat; }
    function escapeAttr(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    if (scrollBtn) {
        window.addEventListener('scroll', () => { scrollBtn.classList.toggle('visible', window.scrollY > 400); });
        scrollBtn.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }

    const darkBtn = document.getElementById('darkToggle');
    if (darkBtn) {
        if (localStorage.getItem('darkMode') === 'true') document.documentElement.setAttribute('data-theme', 'dark');
        darkBtn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
            localStorage.setItem('darkMode', !isDark);
        });
    }
})();