document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        const allExams = await getExamHistory();
        const allSillyMistakes = await getAllSillyMistakes();

        if (allExams.length === 0) {
            document.querySelector('.dashboard-content').innerHTML = `
                <div style="text-align:center; padding: 50px; color: var(--text-color);">
                    <h3>No Exam History Found</h3>
                    <p>Take some exams to see your analytics dashboard!</p>
                    <a href="index.html" class="nav-btn" style="display:inline-block; margin-top:20px; background:var(--primary-color);">Start an Exam</a>
                </div>
            `;
            return;
        }

        // --- Calculate Stats (from summary data only — no details needed) ---
        let totalQuestionsAttempted = 0;
        let totalCorrect = 0;
        let totalMaxMarks = 0;
        let totalMarksObtained = 0;

        allExams.forEach(e => {
            totalQuestionsAttempted += (e.correct + e.incorrect);
            totalCorrect += e.correct;
            totalMaxMarks += e.max_marks;
            totalMarksObtained += Math.max(0, e.total_marks);
        });

        const avgScore = totalMaxMarks > 0 ? (totalMarksObtained / totalMaxMarks) * 100 : 0;
        const avgAccuracy = totalQuestionsAttempted > 0 ? (totalCorrect / totalQuestionsAttempted) * 100 : 0;

        // Only load details for recent exams (used by charts), not all 10K+
        const sortedExams = [...allExams].sort((a, b) => new Date(a.date) - new Date(b.date));
        const recentExams = sortedExams.slice(-15);
        const recentExamIds = recentExams.map(e => e.id);

        let allDetails = [];
        if (typeof getExamDetailsForIds === 'function') {
            allDetails = await getExamDetailsForIds(recentExamIds);
        } else {
            // Fallback for older db.js
            for (const exam of recentExams) {
                const details = await getExamDetails(exam.id);
                allDetails = allDetails.concat(details);
            }
        }

        // Also load all details for weak areas analysis (uses ALL exams)
        let allDetailsForWeakAreas = [];
        if (typeof getAllExamDetails === 'function') {
            allDetailsForWeakAreas = await getAllExamDetails();
        } else {
            allDetailsForWeakAreas = allDetails; // fallback
        }

        // Refine total time from all details
        const totalTimeSecs = allDetailsForWeakAreas.reduce((sum, d) => sum + (d.time_spent || 0), 0);
        const hours = Math.floor(totalTimeSecs / 3600);
        const minutes = Math.floor((totalTimeSecs % 3600) / 60);

        // Update Top Cards
        document.getElementById('totalTestsVal').textContent = allExams.length;
        document.getElementById('avgScoreVal').textContent = avgScore.toFixed(1) + '%';
        document.getElementById('avgAccuracyVal').textContent = avgAccuracy.toFixed(1) + '%';
        document.getElementById('totalTimeVal').textContent = `${hours}h ${minutes}m`;

        // --- Prepare Chart Configuration ---
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#e0e0e0' : '#333';
        const gridColor = isDark ? '#333' : '#ddd';

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: { legend: { labels: { color: textColor } } }
        };

        // --- 1. Progress Over Time (Line Chart) ---
        // recentExams already computed above (last 15 sorted chronologically)

        const progressLabels = recentExams.map(e => new Date(e.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));
        const progressData = recentExams.map(e => e.max_marks > 0 ? ((e.total_marks / e.max_marks) * 100).toFixed(1) : 0);

        new Chart(document.getElementById('progressChart'), {
            type: 'line',
            data: {
                labels: progressLabels,
                datasets: [{
                    label: 'Score Percentage',
                    data: progressData,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.2)',
                    borderWidth: 2,
                    tension: 0.3, // Smooth curves
                    fill: true,
                    pointBackgroundColor: '#2980b9',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: { ...commonOptions, scales: { y: { min: 0, max: 100, ...commonOptions.scales.y } } }
        });

        // --- 2. Concept Weak Areas (Bar Chart) ---
        // Analyze silly mistakes / incorrect answers from recent exams
        // For GATE, we might group by "Explanation" keywords or simply by Question Type if proper tagging isn't available
        // Let's use Question Type (MCQ/MSQ/NAT) as a proxy for "Weak Areas" since tags aren't in the schema

        const wrongTypes = { 'MCQ': 0, 'MSQ': 0, 'NAT': 0 };
        allDetailsForWeakAreas.forEach(d => {
            if (d.status === 'incorrect') {
                let typeName = 'MCQ';
                if (d.type === 'multiple') typeName = 'MSQ';
                else if (d.type === 'nat' || d.type === 'numerical' || d.type === 'numeric') typeName = 'NAT';
                wrongTypes[typeName]++;
            }
        });

        new Chart(document.getElementById('weakAreasChart'), {
            type: 'bar',
            data: {
                labels: Object.keys(wrongTypes),
                datasets: [{
                    label: 'Total Incorrect Answers',
                    data: Object.values(wrongTypes),
                    backgroundColor: ['#e74c3c', '#9b59b6', '#f39c12'],
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                ...commonOptions,
                plugins: { ...commonOptions.plugins, legend: { display: false } },
                scales: {
                    x: { ...commonOptions.scales.x, grid: { display: false } }, // hide vertical grid
                    y: { ...commonOptions.scales.y, beginAtZero: true }
                }
            }
        });

        // --- 3. Negative Marks Trend (Line/Area Chart) ---
        const negativeData = recentExams.map(e => {
            // Calculate negative marks for this exam from its details
            const examDetails = allDetails.filter(d => d.exam_id === e.id);
            let negSum = 0;
            examDetails.forEach(d => {
                if ((d.marks_obtained || 0) < 0) {
                    negSum += Math.abs(d.marks_obtained);
                }
            });
            return negSum.toFixed(2);
        });

        new Chart(document.getElementById('negativeMarksChart'), {
            type: 'line',
            data: {
                labels: progressLabels,
                datasets: [{
                    label: 'Negative Marks Lost',
                    data: negativeData,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.2)',
                    borderWidth: 2,
                    tension: 0.1,
                    fill: true,
                    stepped: true // Step chart look
                }]
            },
            options: {
                ...commonOptions,
                scales: { y: { beginAtZero: true, ...commonOptions.scales.y } }
            }
        });

        // --- Generate AI Insights ---
        generateInsights(avgScore, avgAccuracy, wrongTypes, negativeData);

    } catch (e) {
        console.error("Error loading analytics:", e);
        document.querySelector('.dashboard-content').innerHTML = `<p style="color:red">Error loading data: ${e.message}</p>`;
    }
});

function generateInsights(avgScore, avgAccuracy, wrongTypes, negativeData) {
    const container = document.getElementById('aiInsightsContent');
    const insights = [];

    // General Performance
    if (avgScore > 75) {
        insights.push({ icon: '🌟', text: `Your average score of <strong>${avgScore.toFixed(1)}%</strong> is excellent. Focus on full-length mock tests to build stamina.` });
    } else if (avgScore > 50) {
        insights.push({ icon: '📈', text: `You are consistently scoring around <strong>${avgScore.toFixed(1)}%</strong>. To break the plateau, spend more time reviewing your unattempted questions.` });
    } else {
        insights.push({ icon: '📚', text: `Focus on mastering foundational concepts first rather than attempting difficult questions.` });
    }

    // Accuracy
    if (avgAccuracy < 60) {
        insights.push({ icon: '🎯', text: `Your accuracy is <strong>${avgAccuracy.toFixed(1)}%</strong>. Slow down and read questions carefully. Quality of attempts matters more than quantity.` });
    }

    // Weak Areas (Question Types)
    const maxWrongType = Object.keys(wrongTypes).reduce((a, b) => wrongTypes[a] > wrongTypes[b] ? a : b);
    if (wrongTypes[maxWrongType] > 5) {
        insights.push({ icon: '🔍', text: `You lose the most marks in <strong>${maxWrongType}</strong> questions (${wrongTypes[maxWrongType]} errors). Practice ${maxWrongType} specific problem sets.` });
    }

    // Negative Trend
    if (negativeData.length > 2) {
        const last = parseFloat(negativeData[negativeData.length - 1]);
        const prev = parseFloat(negativeData[negativeData.length - 2]);
        if (last > prev && last > 2) {
            insights.push({ icon: '🚨', text: `Warning: Your negative marks increased to <strong>${last}</strong> in recent tests. Avoid blind guessing!` });
        } else if (last < prev && last < 1) {
            insights.push({ icon: '✅', text: `Great job controlling negative marks recently. Excellent risk management.` });
        }
    }

    container.innerHTML = insights.map(i => `
        <div class="insight-point">
            <div class="insight-icon">${i.icon}</div>
            <div>${i.text}</div>
        </div>
    `).join('');
}
