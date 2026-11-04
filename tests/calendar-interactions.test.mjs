import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('function renderCalendar(){'),
  source.indexOf('function renderBirthdays(){'));

class Element {
  constructor(tag, text = '', className = '') {
    this.tagName = tag;
    this.textContent = text;
    this.className = className;
    this.children = [];
    this.attributes = {};
    this.style = {setProperty() {}};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  get childElementCount() { return this.children.length; }
}

function calendar(portrait = true) {
  const elements = Object.fromEntries(['days', 'monthTitle', 'dayDate', 'dayList']
    .map(id => [id, new Element('div')]));
  const events = [
    {id: 'timed', title: 'Meeting', start_at: '2026-11-01T10:00:00+08:00', all_day: false},
    {id: 'all-day', title: 'Birthday', start_at: '2026-11-01', all_day: true}
  ];
  const opened = [];
  const state = {month: '2026-11', selected: '2026-11-02', filters: new Map()};
  const context = {
    state, today: '2026-11-05', portraitLayout: {matches: portrait},
    $: id => elements[id],
    range: () => ({from: '2026-11-01', to: '2026-11-30'}),
    node: (tag, text, className) => new Element(tag, text, className),
    button: (text, action, className) => Object.assign(new Element('button', text, className), {onclick: action}),
    lunarInfo: () => ({date: 'Lunar', festivals: []}),
    eventsOn: day => day === '2026-11-01' ? events : [],
    time: () => '10:00 AM', color: () => '#957367',
    clockTime: () => '11:00 AM', showDetails: event => opened.push(event.id),
    renderBirthdays() {}
  };
  vm.createContext(context);
  vm.runInContext(renderSource, context);
  context.renderCalendar();
  return {context, state, elements, opened};
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

test('portrait calendar markers are inert, including all-day events', () => {
  const {elements, state, opened} = calendar();
  const cell = elements.days.children[0];
  const markers = descendants(cell).filter(element => element.className.includes('calendar-event') &&
    !element.className.includes('calendar-event-'));
  assert.equal(markers.length, 2);
  for (const marker of markers) {
    assert.equal(marker.tagName, 'span');
    assert.equal(marker.onclick, undefined);
    cell.onclick({target: {closest: () => marker}});
  }
  assert.equal(state.selected, '2026-11-02');
  assert.deepEqual(opened, []);
});

test('clicking a date cell selects that day and updates its activity list', () => {
  const {elements, state, opened} = calendar();
  elements.days.children[0].onclick({target: {closest: () => null}});
  assert.equal(state.selected, '2026-11-01');
  assert.equal(elements.dayList.children.length, 2);
  assert.equal(elements.dayList.children[0].className, 'day-card');
  elements.dayList.children[0].onclick();
  assert.deepEqual(opened, ['timed']);
  assert.equal(elements.days.children.at(-1).onclick, undefined);
});

test('landscape event buttons open details without triggering cell selection', () => {
  const {context, elements, state, opened} = calendar(false);
  const cell = elements.days.children[0];
  const marker = descendants(cell).find(element => element.className === 'calendar-event');
  assert.equal(marker.tagName, 'button');
  marker.onclick();
  cell.onclick({target: {closest: () => marker}});
  assert.deepEqual(opened, ['timed']);
  assert.equal(state.selected, '2026-11-02');
  context.portraitLayout.matches = true;
  context.renderCalendar();
  const portraitMarker = descendants(elements.days.children[0])
    .find(element => element.className === 'calendar-event');
  assert.equal(portraitMarker.tagName, 'span');
});

test('visible viewport height updates for resizing, offsets and browsers without VisualViewport', () => {
  const start = source.indexOf('function updateCalendarViewport(){');
  assert.ok(start >= 0);
  const viewportSource = source.slice(start, source.indexOf('\nupdateCalendarViewport();', start));
  const properties = new Map();
  const context = {
    window: {innerHeight: 768, visualViewport: {height: 720, offsetTop: 12, scale: 1}},
    document: {documentElement: {style: {setProperty: (key, value) => properties.set(key, value)}}}
  };
  vm.createContext(context);
  vm.runInContext(viewportSource, context);
  context.updateCalendarViewport();
  assert.equal(properties.get('--calendar-viewport-height'), '720px');
  assert.equal(properties.get('--calendar-viewport-top'), '12px');
  context.window.visualViewport.height = 960;
  context.updateCalendarViewport();
  assert.equal(properties.get('--calendar-viewport-height'), '960px');
  context.window.visualViewport.scale = 2;
  context.window.visualViewport.height = 480;
  context.updateCalendarViewport();
  assert.equal(properties.get('--calendar-viewport-height'), '960px');
  delete context.window.visualViewport;
  context.updateCalendarViewport();
  assert.equal(properties.get('--calendar-viewport-height'), '768px');
  assert.equal(properties.get('--calendar-viewport-top'), '0px');
});
