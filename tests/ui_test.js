/* Render renderIdle() in each schedule state with a stubbed browser. */
const fs = require('fs'), re_ = require('util');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/g)
  .map(s => s.replace(/^<script>|<\/script>$/g, ''))
  .sort((a, b) => b.length - a.length)[0];

// --- browser stubs -------------------------------------------------------
const els = {};
function fakeEl(){ return { classList:{add(){},remove(){},toggle(){}}, style:{}, innerHTML:'',
  textContent:'', value:'', focus(){}, setAttribute(){}, getAttribute(){return null;},
  appendChild(){}, remove(){}, querySelectorAll(){return [];} }; }
global.document = {
  getElementById: id => (els[id] = els[id] || fakeEl()),
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: fakeEl,
  hidden: false
};
global.window = { scrollTo(){}, open(){} };
global.requestAnimationFrame = f => f();
global.google = { script: { run: new Proxy({}, { get: () => function(){ return global.google.script.run; } }) } };
global.confirm = () => true;
global.setInterval = () => 0; global.clearInterval = () => {};
global.setTimeout = (f) => 0; global.clearTimeout = () => {};

eval(js.replace(/^boot\(\);$/m, ''));   // load without auto-booting

let pass = 0, fail = 0;
function ok(label, cond, extra){
  cond ? pass++ : fail++;
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + label + (cond ? '' : '   ' + (extra||'')));
}
function count(hay, needle){ return hay.split(needle).length - 1; }

const SEDERS = [
  { key:'boker', name:'סדר בוקר', icon:'☀️', color:'#D8B08C', defaultStart:'08:30' },
  { key:'tzohorayim', name:'סדר צהריים', icon:'🌤️', color:'#B98A63', defaultStart:'14:30' },
  { key:'erev', name:'סדר ערב', icon:'🌙', color:'#E9B8BC', defaultStart:'20:30' }
];
const GOALS = [
  { id:'g1', name:'מסכת תענית', unit:'דף', total:30, done:12, percent:40, hasTarget:true,
    color:'#E9B8BC', categoryIcon:'📖', position:'דף י״ב ע״ב', status:'active' },
  { id:'g2', name:'מסילת ישרים', unit:'פרק', total:0, done:4, percent:null, hasTarget:false,
    color:'#B98A63', categoryIcon:'💭', position:'', status:'active' }
];
function bootObj(extra){
  return Object.assign({
    goals: GOALS, seders: SEDERS, currentSeder:'erev', today:'2026-09-08',
    todayPlan: [], current: null, palette:['#E9B8BC'], dayNames:['א'],
    settings:{ defaultDurationMin:90 }, planning:{ showPrompt:false }
  }, extra || {});
}

/* ====================================================================== */
console.log('\n--- daily path: a seder is running now ---');
FREE_OPEN = false;
BOOT = bootObj({
  current: { inWindow:true, startsInMin:-5,
    block:{ id:'p1', goalId:'g1', goalName:'מסכת תענית', seder:'erev',
            startTime:'20:30', durationMin:90 } },
  todayPlan: [{ id:'p1', goalId:'g1', goalName:'מסכת תענית', seder:'erev',
                startTime:'20:30', durationMin:90, status:'planned' }]
});
let out = renderIdle();
ok('exactly one start button', count(out, 'id="startBtn"') === 1);
ok('no <select> in the daily path — nothing to choose', !/<select/.test(out), out.match(/<select[\s\S]{0,60}/));
ok('book is pre-bound to the scheduled block', out.includes('id="startGoal" value="g1"'));
ok('plan id carried through so the block gets marked done', out.includes('id="startPlanId" value="p1"'));
ok('planned minutes carried for the overtime bar', out.includes('id="startPlannedMin" value="90"'));
ok('seder inherited from the block, not the clock', out.includes('id="startSeder" value="erev"'));
ok('shows where you stopped last time', out.includes('דף י״ב ע״ב'));
ok('free study is present but collapsed', out.includes('לימוד חופשי') && !out.includes('id="startGoal" class'));
ok('no target/goal setup wording anywhere', !/יעד|מטרה|סה״כ/.test(out), out.match(/יעד|מטרה|סה״כ/));

console.log('\n--- next seder later today ---');
BOOT = bootObj({ current: { inWindow:false, startsInMin:75,
  block:{ id:'p2', goalId:'g2', goalName:'מסילת ישרים', seder:'erev',
          startTime:'21:45', durationMin:60 } } });
out = renderIdle();
ok('offers an early start', out.includes('התחל מוקדם'));
ok('still one button, still no select', count(out,'id="startBtn"') === 1 && !/<select/.test(out));
ok('shows how long until it starts', out.includes('בעוד'));

console.log('\n--- nothing scheduled right now ---');
BOOT = bootObj({ current: null, todayPlan: [] });
out = renderIdle();
ok('does not push goal setup', !out.includes('הצב') && !out.includes('סה״כ'));
ok('free study offered as the escape hatch', out.includes('לימוד חופשי'));
ok('no start button until free study is opened', !out.includes('id="startBtn"'));

FREE_OPEN = true;
out = renderIdle();
ok('opening free study reveals the picker', /<select/.test(out) && out.includes('id="startBtn"'));
ok('free study sends no plan id', out.includes('id="startPlanId" value=""'));
ok('free study sends zero planned minutes', out.includes('id="startPlannedMin" value="0"'));
FREE_OPEN = false;

console.log('\n--- empty state points at planning, not at goal setup ---');
BOOT = bootObj({ goals: [] });
out = renderIdle();
ok('sends the user to weekly planning', out.includes('תכנן את השבוע'));
ok('mentions motzash as the setup moment', out.includes('מוצ״ש'));
ok('does not ask for a target', !/יעד|סה״כ יחידות/.test(out));

console.log('\n--- motzash banner gating ---');
BOOT = bootObj({ planning:{ showPrompt:false } });
renderMotzashBanner();
ok('hidden midweek', els.motzashBanner.innerHTML === '');
BOOT = bootObj({ planning:{ showPrompt:true } });
renderMotzashBanner();
ok('shown when the window is open and next week is empty',
  els.motzashBanner.innerHTML.includes('שבוע טוב'));

console.log('\n--- targets card only nags about books actually studied ---');
REVIEW = { needTarget: [], books: [], bySeder:{}, totalMin:0, diffMin:0, daysLearned:0,
           reviewWeekStart:'2026-09-06', reviewWeekEnd:'2026-09-12' };
renderTargetsCard();
ok('nothing to set -> card stays empty', els.targetsCard.innerHTML === '');
REVIEW.needTarget = [{ goalId:'g2', name:'מסילת ישרים', unit:'פרק', done:4, icon:'💭' }];
renderTargetsCard();
ok('offers a target for the studied targetless book',
  els.targetsCard.innerHTML.includes('מסילת ישרים'));
ok('skipping is an explicit option', els.targetsCard.innerHTML.includes('דלג'));
ok('shows cumulative progress so far', els.targetsCard.innerHTML.includes('נלמדו 4'));

console.log('\n--- bookshelf renders both kinds of book ---');
BOOT = bootObj();
renderGoals();
let gl = els.goalsList.innerHTML;
ok('targeted book shows a ratio', gl.includes('12 / 30'));
ok('targeted book shows a percentage', gl.includes('40%'));
ok('targetless book shows a cumulative count', gl.includes('נלמדו 4'));
ok('targetless book is labelled, not shown as 0%', gl.includes('ללא יעד') && !gl.includes('NaN'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
