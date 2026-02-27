// exam_library_script.js — Exam Library tree rendering + attempt tracking
(async function () {
    'use strict';

    // ====== State ======
    let indexData = null;
    let attemptMap = {};   // { examTitle: attemptCount }
    let activeFilter = 'all';
    let searchTerm = '';

    // Multi-Select State
    let isMultiSelectMode = false;
    let selectedExams = new Map(); // file -> name

    // ====== DOM Refs ======
    const contentEl = document.getElementById('libContent');
    const searchInput = document.getElementById('libSearch');
    const statsEl = document.getElementById('libStats');
    const scrollBtn = document.getElementById('scrollTopBtn');

    // Multi-Select DOM Elements
    const multiSelectToggle = document.getElementById('multiSelectToggle');
    const multiSelectFab = document.getElementById('multiSelectFab');
    const fabSelectedCount = document.getElementById('fabSelectedCount');
    const fabAvailableCount = document.getElementById('fabAvailableCount'); // Added missing DOM ref
    const fabTotalQuestions = document.getElementById('fabTotalQuestions');
    const fabGenerateBtn = document.getElementById('fabGenerateBtn');

    // ====== Environment Detection ======
    const isFileMode = window.location.protocol === 'file:';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // ====== Init ======
    await loadAttemptData();
    await loadIndex();

    // ====== Load exam index: prioritize static for GitHub Pages ======
    async function loadIndex() {
        contentEl.innerHTML = '<div class="lib-loading"><div class="spinner"></div><br>Loading exam library...</div>';
        try {
            if (window.EXAM_INDEX) {
                // 1. First priority: Pre-loaded static index (best for GitHub Pages)
                indexData = window.EXAM_INDEX;
            } else if (!isFileMode) {
                // 2. Second priority: Try fetching static JSON using a relative path
                try {
                    const resp = await fetch('./exam_index.json');
                    if (resp.ok) {
                        indexData = await resp.json();
                    } else {
                        throw new Error('Static index not found');
                    }
                } catch (err) {
                    // 3. Fallback: Local dynamic Node API (only if running locally)
                    if (isLocalhost) {
                        const apiResp = await fetch('/api/exam-index');
                        if (!apiResp.ok) throw new Error('API returned ' + apiResp.status);
                        indexData = await apiResp.json();
                    } else {
                        throw err; // Re-throw if on GitHub Pages and static fetch fails
                    }
                }
            } else {
                throw new Error('EXAM_INDEX not found. Ensure exam_index.js is loaded in file:// mode.');
            }
            render();
        } catch (e) {
            contentEl.innerHTML = '<div class="lib-empty">❌ Failed to load exam library.<br><small>Make sure you ran <code>node generate_exam_index.js</code> before pushing to GitHub!</small></div>';
            console.error(e);
        }
    }

    // ====== Load attempt data from IndexedDB ======
    async function loadAttemptData() {
        try {
            if (typeof initDB === 'function') {
                await initDB();
            }
            if (typeof getExamHistory === 'function') {
                const history = await getExamHistory();
                attemptMap = {};
                history.forEach(exam => {
                    const key = exam.title;
                    attemptMap[key] = (attemptMap[key] || 0) + 1;
                });
            }
        } catch (e) {
            console.warn('Could not load exam history for attempt tracking:', e);
        }
    }

    // ====== Render ======
    function render() {
        if (!indexData || !indexData.sources) {
            contentEl.innerHTML = '<div class="lib-empty">No exam sources found.</div>';
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

        exams.forEach(exam => {
            html += renderExamItem(exam, depth);
        });

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
                    ${!isMultiSelectMode ? actionHtml : ''}
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
                multiSelectFab.style.display = 'flex';
                selectedExams.clear();
                updateFabUI();
            } else {
                multiSelectToggle.classList.remove('active');
                multiSelectToggle.innerHTML = '✨ Multi-Select Exam';
                multiSelectToggle.style.backgroundColor = 'rgba(155, 89, 182, 0.2)';
                multiSelectToggle.style.borderColor = '#9b59b6';
                multiSelectFab.style.display = 'none';
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
        if (fabSelectedCount) {
            fabSelectedCount.textContent = `${selectedExams.size} exams selected`;
        }

        let totalAvailableQuestions = 0;
        selectedExams.forEach((data) => {
            totalAvailableQuestions += data.questions;
        });

        if (fabAvailableCount) {
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

        const totalRequested = parseInt(fabTotalQuestions.value, 10);
        if (isNaN(totalRequested) || totalRequested < 1) {
            alert('Please enter a valid number of total questions.');
            return;
        }

        fabGenerateBtn.disabled = true;
        fabGenerateBtn.textContent = 'Generating... ⌛';

        try {
            const rawExamsData = [];
            for (const [file, examMeta] of selectedExams) {
                const data = await fetchExamData(file);
                if (data && data.sections) {
                    rawExamsData.push({ name: examMeta.name, file: file, data });
                }
            }

            if (rawExamsData.length === 0) {
                throw new Error("Could not load any data from selected exams.");
            }

            const customExam = generateMixedExamData(rawExamsData, totalRequested);
            sessionStorage.setItem('retryExamData', JSON.stringify(customExam));
            window.location.href = 'index.html';

        } catch (error) {
            console.error(error);
            alert('❌ Error generating custom exam: ' + error.message);
            fabGenerateBtn.disabled = false;
            fabGenerateBtn.textContent = 'Generate & Start ▶';
        }
    };

    // ====== Fetch Exam Data (GitHub Pages relative fetch logic) ======
    let _fetchIdCounter = 0;
    function fetchExamData(jsonFile) {
        if (isFileMode) {
            // File:// mode: JSONP with unique callbacks
            return new Promise((resolve, reject) => {
                const jsFile = jsonFile.replace(/\.json$/, '_load.js');
                const callbackName = '__examLoadCB_' + (++_fetchIdCounter) + '_' + Date.now();
                let resolved = false;

                window[callbackName] = function (examData) {
                    if (resolved) return;
                    resolved = true;
                    delete window[callbackName];
                    resolve(examData);
                };

                window.__examLoadCallback = function (examData) {
                    if (resolved) return;
                    resolved = true;
                    delete window[callbackName];
                    resolve(examData);
                };

                const script = document.createElement('script');
                script.src = jsFile;
                script.onload = () => {
                    try { document.head.removeChild(script); } catch (e) { }
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            delete window[callbackName];
                            console.warn(`Timeout loading: ${jsFile}`);
                            resolve(null);
                        }
                    }, 3000);
                };
                script.onerror = () => {
                    if (!resolved) {
                        resolved = true;
                        delete window[callbackName];
                    }
                    try { document.head.removeChild(script); } catch (e) { }
                    console.warn(`Failed to load script: ${jsFile}`);
                    resolve(null);
                };
                document.head.appendChild(script);
            });
        } else {
            // HTTP/HTTPS Mode (GitHub Pages or Localhost)
            // Try fetching the raw JSON file natively using its relative path!
            return fetch(jsonFile)
                .then(async r => {
                    if (r.ok) return r.json();
                    
                    // If native static fetch fails, and we are locally running the node app, try the API
                    if (isLocalhost) {
                        const apiRes = await fetch('/api/exam-data?file=' + encodeURIComponent(jsonFile));
                        if (apiRes.ok) return apiRes.json();
                    }
                    throw new Error('Failed to load: ' + jsonFile);
                })
                .catch(err => {
                    console.warn('Fetch failed for ' + jsonFile + ':', err);
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
            return {
                examName: examObj.name,
                questions: questions
            };
        });

        const selectedQuestions = [];
        const numExams = pools.length;

        let targetPerExam = Math.floor(totalRequested / numExams);
        let remainder = totalRequested % numExams;

        let distribution = pools.map(p => targetPerExam);
        for (let i = 0; i < remainder; i++) {
            distribution[i % numExams]++;
        }

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

        const subjectMap = [
            { id: 'TOC', keys: ['TOC', 'THEORY OF COMPUTATION', 'AUTOMATA'] },
            { id: 'OS', keys: ['OS', 'OPERATING SYSTEM', 'OPERATING SYSTEMS'] },
            { id: 'DBMS', keys: ['DBMS', 'DATABASE', 'DATABASE MANAGEMENT SYSTEM'] },
            { id: 'CN', keys: ['CN', 'COMPUTER NETWORK', 'COMPUTER NETWORKS'] },
            { id: 'COA', keys: ['COA', 'COMPUTER ORGANIZATION', 'ARCHITECTURE'] },
            { id: 'CD', keys: ['CD', 'COMPILER DESIGN', 'COMPILER'] },
            { id: 'DL', keys: ['DL', 'DIGITAL LOGIC', 'DIGITAL'] },
            { id: 'DSA', keys: ['DSA', 'DATA STRUCTURES AND ALGORITHMS', 'DATA STRUCTURE', 'C AND DS', 'DATA STRUCTURES'] },
            { id: 'ALGO', keys: ['ALGO', 'ALGORITHM', 'ALGORITHMS', 'DA', 'DESIGN AND ANALYSIS'] },
            { id: 'C', keys: ['C PROGRAMMING', 'PROGRAMMING C', 'C LANGUAGE'] },
            { id: 'DM', keys: ['DM', 'DISCRETE MATH', 'DISCRETE MATHEMATICS'] },
            { id: 'EM', keys: ['EM', 'ENGINEERING MATH', 'ENGINEERING MATHEMATICS', 'MATHS'] },
            { id: 'GA', keys: ['GA', 'APTITUDE', 'GENERAL APTITUDE'] },
            { id: 'MOCK', keys: ['MOCK', 'MOCKS', 'FULL SYLLABUS', 'TEST SERIES'] }
        ];

        const abbreviations = examsArray.map(e => {
            const pathStr = decodeURIComponent(e.file).toUpperCase().replace(/[-_]/g, ' ');
            for (const sub of subjectMap) {
                for (const key of sub.keys) {
                    const regex = new RegExp(`(?:^|[^A-Z])(${key})(?:[^A-Z]|$)`);
                    if (regex.test(pathStr) || regex.test(e.name.toUpperCase())) {
                        return sub.id;
                    }
                }
            }

            const parts = e.file.split('/');
            if (parts.length >= 3) {
                let folder = parts[parts.length - 3];
                if (!folder || folder.toLowerCase() === 'exams') folder = parts[parts.length - 2];
                if (folder) {
                    folder = folder.replace(/[-_]/g, ' ').trim();
                    if (folder.length > 15) folder = folder.substring(0, 12) + '..';
                    return folder.toUpperCase();
                }
            }

            return 'MIX';
        }).slice(0, 3);

        const uniqueAbbrevs = [...new Set(abbreviations)];
        const joinStr = uniqueAbbrevs.join(' + ');

        const finalName = `Custom Mix: ${joinStr}${examsArray.length > 3 ? '...' : ''} (${selectedQuestions.length} Qs)`;
        const durationMins = Math.ceil((selectedQuestions.length / 65) * 180);

        return {
            title: finalName,
            duration: durationMins || 30,
            sections: [
                {
                    name: "Mixed Section",
                    questions: selectedQuestions
                }
            ]
        };
    }

    // ====== Launch Exam (GitHub Pages relative logic) ======
    window.launchExam = function (el) {
        const jsonFile = el.dataset.file;
        if (!jsonFile) return;

        const btn = el.querySelector('.exam-start-btn');
        if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }

        if (isFileMode) {
            // File:// mode fallback
            const jsFile = jsonFile.replace(/\.json$/, '_load.js');
            window.__examLoadCallback = function (examData) {
                delete window.__examLoadCallback;
                try {
                    sessionStorage.setItem('retryExamData', JSON.stringify(examData));
                    window.location.href = 'index.html';
                } catch (e) {
                    alert('❌ Could not store exam data: ' + e.message);
                    if (btn) { btn.textContent = 'Start ▶'; btn.disabled = false; }
                }
            };

            const script = document.createElement('script');
            script.src = jsFile;
            script.onerror = function () {
                delete window.__examLoadCallback;
                alert('❌ Could not load exam file.\nRun: node generate_exam_index.js');
                if (btn) { btn.textContent = 'Start ▶'; btn.disabled = false; }
                document.head.removeChild(script);
            };
            document.head.appendChild(script);
        } else {
            // HTTP/HTTPS Mode (GitHub Pages or Localhost)
            // Fetch directly using the relative path!
            fetch(jsonFile)
                .then(async r => {
                    if (r.ok) return r.json();
                    
                    if (isLocalhost) {
                        const apiRes = await fetch('/api/exam-data?file=' + encodeURIComponent(jsonFile));
                        if (apiRes.ok) return apiRes.json();
                    }
                    throw new Error('Failed to load exam file natively');
                })
                .then(examData => {
                    sessionStorage.setItem('retryExamData', JSON.stringify(examData));
                    window.location.href = 'index.html'; // This is also relative and will work on GH pages!
                })
                .catch(e => {
                    alert('❌ Could not load exam: ' + e.message);
                    if (btn) { btn.textContent = 'Start ▶'; btn.disabled = false; }
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
            if (searchTerm.length === 0) { render(); } else { applySearch(); }
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

    function updateIndexTimestamp() {
        const tsEl = document.getElementById('indexTimestamp');
        if (!tsEl || !indexData || !indexData.generated) return;
        try {
            if (indexData.dynamic) {
                tsEl.textContent = '🔄 Live — dynamic';
                tsEl.title = 'This index is loaded dynamically from the server.\nAdd/remove exam files and refresh to see changes.';
                tsEl.classList.remove('stale');
                tsEl.style.color = 'var(--green)';
                return;
            }
            const d = new Date(indexData.generated);
            const now = new Date();
            const diffMs = now - d;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            let ageText;
            if (diffDays === 0) ageText = 'today';
            else if (diffDays === 1) ageText = 'yesterday';
            else ageText = `${diffDays} days ago`;
            tsEl.textContent = `Index updated ${ageText}`;
            tsEl.title = `Generated: ${d.toLocaleString()}\nRun "node generate_exam_index.js" to refresh after adding/removing exams.`;
            if (diffDays > 7) { tsEl.classList.add('stale'); }
        } catch (e) { tsEl.textContent = ''; }
    }

    function getCategoryIcon(cat) { return { pyq: '📜', test_series: '📋', subject: '📚', practice: '🔄', other: '📦' }[cat] || '📦'; }
    function formatCategory(cat) { return { pyq: 'PYQ', test_series: 'Test Series', subject: 'Subject', practice: 'Practice', other: 'Other' }[cat] || cat; }
    function escapeAttr(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    if (scrollBtn) {
        window.addEventListener('scroll', () => { scrollBtn.classList.toggle('visible', window.scrollY > 400); });
        scrollBtn.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }

    const darkBtn = document.getElementById('darkToggle');
    if (darkBtn) {
        const saved = localStorage.getItem('darkMode');
        if (saved === 'true') document.documentElement.setAttribute('data-theme', 'dark');
        darkBtn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
            localStorage.setItem('darkMode', !isDark);
        });
    }
})();