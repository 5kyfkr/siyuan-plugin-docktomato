'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tomato.js'), 'utf8');
const section = source.slice(source.indexOf('    function getMonthStartDate('), source.indexOf('    function calculateDailyStats('));
const previousTZ = process.env.TZ;
try {
    for (const timezone of ['UTC', 'Asia/Shanghai', 'Europe/Paris', 'America/New_York', 'Pacific/Honolulu']) {
        process.env.TZ = timezone;
        const context = vm.createContext({ __tt: (_key, values) => `${values.value1}-${values.value2}` });
        vm.runInContext(section, context);
        context.days = ['2025-12-31', '2026-01-01', '2026-11-01', '2026-11-18', '2026-11-30'].map(date => ({
            date, tomatoCount: 1, tomatoActual: 60, tomatoPlanned: 60, stopwatchCount: 0,
            stopwatchActual: 0, breakCount: 0, breakActual: 0, focusTime: 60, distractionCount: 0,
        }));
        const result = JSON.parse(vm.runInContext('JSON.stringify(calculateMonthlyStats(days).map(month => [month.monthStart, formatMonth(month.monthStart), month.focusTime, month.tomatoCount]))', context));
        assert.deepEqual(result, [
            ['2026-11-01', '2026-11', 180, 3], ['2026-01-01', '2026-01', 60, 1], ['2025-12-01', '2025-12', 60, 1],
        ], timezone + ' preserves local month labels and totals across month/year boundaries');
    }
} finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
}
console.log('monthly statistics timezone tests passed');
