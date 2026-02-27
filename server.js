/**
 * server.js — Background API server for dynamic exam index
 * 
 * Usage:  node server.js   (or double-click start.bat)
 * Then open index.html via file:// as usual.
 * The exam library will auto-detect the server and load dynamically.
 * 
 * No npm install required — uses only Node.js built-in modules.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;
const EXAMS_DIR = path.join(ROOT, 'Exams');

// ====== MIME Types ======
const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

// ====== Exam Index Config (mirrors generate_exam_index.js) ======
const SKIP_DIRS = new Set(['images', 'myenv', '__pycache__', 'node_modules', '.git']);
const SKIP_FILES = new Set(['localization.js', 'new.js', 'output.txt', 'slot_tree.txt',
    'localization_images.py', 'msq_negative.py', 'organize_files.py',
    'localization_image.py', 'organizer_files.py', 'image_localization.js',
    'image_localization.py', 'update_time_and_title.js']);

const SOURCE_NAMES = {
    '000_PYQ': 'GATE & ISRO PYQ (Topic-wise)',
    '000_PYQ_2': 'GATE PYQ Collection 2',
    '00_2025_GateAtZeal': 'Gate At Zeal 2025',
    '00_2026_GateAtZeal': 'Gate At Zeal 2026',
    '00_25_26_Made_Easy': 'Made Easy 2025-26',
    '00_ME_WB': 'Made Easy Workbook',
    '00_MyWrongQs': 'My Wrong Questions',
    '00_TCS_NQT': 'TCS NQT',
    '00_goClassesTestSeries2022_2026': 'GO Classes Test Series (2021-2026)',
    'Apti': 'Aptitude',
    'CN': 'Computer Networks',
    'C_Programming': 'C Programming',
    'DM': 'Discrete Mathematics',
    'DigitalLogic': 'Digital Logic',
    'testing': 'Testing / Sample'
};

const CATEGORY_MAP = {
    '000_PYQ': 'pyq',
    '000_PYQ_2': 'pyq',
    '00_2025_GateAtZeal': 'test_series',
    '00_2026_GateAtZeal': 'test_series',
    '00_25_26_Made_Easy': 'test_series',
    '00_ME_WB': 'test_series',
    '00_MyWrongQs': 'practice',
    '00_TCS_NQT': 'other',
    '00_goClassesTestSeries2022_2026': 'test_series',
    'Apti': 'subject',
    'CN': 'subject',
    'C_Programming': 'subject',
    'DM': 'subject',
    'DigitalLogic': 'subject',
    'testing': 'other'
};

function prettifyName(name) {
    return name
        .replace(/^S\d+_/, '')
        .replace(/^\d+_/, '')
        .replace(/_/g, ' ')
        .replace(/\bjson\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getExamMetadata(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        let totalQuestions = 0;
        if (data.sections && Array.isArray(data.sections)) {
            data.sections.forEach(s => {
                if (s.questions) totalQuestions += s.questions.length;
            });
        } else if (data.data && Array.isArray(data.data)) {
            totalQuestions = data.data.length;
        }
        return {
            title: data.title || prettifyName(path.basename(filePath, '.json')),
            duration: data.duration || 0,
            totalQuestions
        };
    } catch (e) {
        return { title: path.basename(filePath, '.json'), duration: 0, totalQuestions: 0 };
    }
}

function scanDirectory(dirPath, relativeTo) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
        return [];
    }
    const children = [];

    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        // Skip _load.js files (generated loader scripts)
        if (entry.name.endsWith('_load.js')) continue;

        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
            const subChildren = scanDirectory(fullPath, relativeTo);
            if (subChildren.length > 0) {
                children.push({
                    type: 'folder',
                    name: prettifyName(entry.name),
                    rawName: entry.name,
                    children: subChildren
                });
            }
        } else if (entry.name.endsWith('.json')) {
            const meta = getExamMetadata(fullPath);
            children.push({
                type: 'exam',
                name: meta.title,
                file: 'Exams/' + relPath,
                questions: meta.totalQuestions,
                duration: meta.duration
            });
        }
    }
    return children;
}

function buildExamIndex() {
    let topLevelDirs;
    try {
        topLevelDirs = fs.readdirSync(EXAMS_DIR, { withFileTypes: true });
    } catch (e) {
        return { generated: new Date().toISOString(), totalSources: 0, sources: [], dynamic: true };
    }

    const categories = [];
    for (const dir of topLevelDirs) {
        if (!dir.isDirectory() || SKIP_DIRS.has(dir.name)) continue;

        const fullPath = path.join(EXAMS_DIR, dir.name);
        const children = scanDirectory(fullPath, EXAMS_DIR);

        if (children.length > 0) {
            categories.push({
                id: dir.name,
                name: SOURCE_NAMES[dir.name] || prettifyName(dir.name),
                category: CATEGORY_MAP[dir.name] || 'other',
                children
            });
        }
    }

    return {
        generated: new Date().toISOString(),
        totalSources: categories.length,
        sources: categories,
        dynamic: true
    };
}

// ====== HTTP Server ======
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // API: Dynamic exam index
    if (pathname === '/api/exam-index') {
        const index = buildExamIndex();
        const json = JSON.stringify(index);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(json);
        return;
    }

    // API: Load exam JSON directly (for fetch-based loading)
    if (pathname === '/api/exam-data' && url.searchParams.has('file')) {
        const file = url.searchParams.get('file');
        // Security: prevent path traversal
        const safePath = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(ROOT, safePath);

        if (!fullPath.startsWith(ROOT) || !fullPath.endsWith('.json')) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        try {
            const raw = fs.readFileSync(fullPath, 'utf8');
            JSON.parse(raw); // Validate it's valid JSON
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(raw);
        } catch (e) {
            res.writeHead(404);
            res.end('Not found');
        }
        return;
    }

    // Static files
    let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    filePath = path.normalize(filePath);

    // Security: prevent path traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found: ' + pathname);
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  🚀 GATE Quiz Generator — Dynamic Exam Server`);
    console.log(`  ──────────────────────────────────────────────`);
    console.log(`  API running on:   http://localhost:${PORT}`);
    console.log(`  Exams directory:  ${EXAMS_DIR}`);
    console.log(`  ──────────────────────────────────────────────`);
    console.log(`  Open index.html as usual (via file://).`);
    console.log(`  The Exam Library will auto-detect this server.`);
    console.log(`  Add/remove exam JSON files and refresh to see changes.\n`);
});
