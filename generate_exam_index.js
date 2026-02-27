/**
 * generate_exam_index.js
 * Scans the Exams/ directory and generates exam_index.json
 * Run with: node generate_exam_index.js
 */

const fs = require('fs');
const path = require('path');

const EXAMS_DIR = path.join(__dirname, 'Exams');
const OUTPUT_FILE = path.join(__dirname, 'exam_index.js');

// Directories to skip
const SKIP_DIRS = new Set(['images', 'myenv', '__pycache__', 'node_modules', '.git']);
const SKIP_FILES = new Set(['localization.js', 'new.js', 'output.txt', 'slot_tree.txt',
    'localization_images.py', 'msq_negative.py', 'organize_files.py',
    'localization_image.py', 'organizer_files.py', 'image_localization.js',
    'image_localization.py', 'update_time_and_title.js']);

// Friendly names for top-level exam sources
const SOURCE_NAMES = {
    '000_PYQ': 'GATE & ISRO PYQ (Topic-wise)',
};

// Category tags for filtering
const CATEGORY_MAP = {
    '000_PYQ': 'pyq',
};

function prettifyName(name) {
    return name
        .replace(/^S\d+_/, '') // Remove S01_, S02_ prefixes
        .replace(/^\d+_/, '')  // Remove leading number prefixes like 1_, 01_
        .replace(/_/g, ' ')    // Replace underscores with spaces
        .replace(/\bjson\b/gi, '') // Remove "json" word
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

// Generate a JSONP-style .js loader file alongside each data.json
// This enables <script> tag loading which works on file:// protocol
let loaderCount = 0;
function generateLoaderFile(jsonFilePath) {
    try {
        const raw = fs.readFileSync(jsonFilePath, 'utf8');
        // Validate it's valid JSON first
        JSON.parse(raw);
        const loaderPath = jsonFilePath.replace(/\.json$/, '_load.js');
        const jsContent = 'window.__examLoadCallback(' + raw.trim() + ');\n';
        fs.writeFileSync(loaderPath, jsContent, 'utf8');
        loaderCount++;
    } catch (e) {
        console.warn(`  ⚠ Could not generate loader for ${jsonFilePath}: ${e.message}`);
    }
}

function scanDirectory(dirPath, relativeTo) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

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
            generateLoaderFile(fullPath);
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

// Main scan
const topLevelDirs = fs.readdirSync(EXAMS_DIR, { withFileTypes: true });
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

const index = {
    generated: new Date().toISOString(),
    totalSources: categories.length,
    sources: categories
};

const jsContent = 'window.EXAM_INDEX = ' + JSON.stringify(index, null, 2) + ';\n';
fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf8');
console.log(`✅ Generated exam_index.js with ${categories.length} sources`);

// Count total exams
let totalExams = 0;
function countExams(items) {
    for (const item of items) {
        if (item.type === 'exam') totalExams++;
        else if (item.children) countExams(item.children);
    }
}
categories.forEach(c => countExams(c.children));
console.log(`📊 Total individual exam files: ${totalExams}`);
console.log(`🔧 Generated ${loaderCount} JSONP loader files (data_load.js)`);
