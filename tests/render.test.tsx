import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import Dashboard from '../components/dashboard';
import AuthPanel from '../components/auth-panel';
import {previewData} from './fixtures/dashboard';
test('Personal and team views render Arabic accessible markup and clearly label fictional review data',()=>{
 const data=previewData();for(const initialSection of ['personal','team'] as const){const html=renderToStaticMarkup(<Dashboard initial={data} preview initialSection={initialSection}/>);assert.ok(html.includes('معاينة'));assert.ok(html.includes('بيانات توضيحية'));assert.ok(html.includes('التنقل الرئيسي'));assert.ok(html.includes('aria-label'));assert.equal(html.includes('اختر لون'),false);}
 const personal=renderToStaticMarkup(<Dashboard initial={data} preview/>);assert.ok(personal.includes('متابعتي'));const team=renderToStaticMarkup(<Dashboard initial={data} preview initialSection="team"/>);assert.ok(team.includes('الإنجاز المسجل'));assert.ok(team.includes('اكتمال'));
});
test('v1.1 missing values stay neutral and configured task goals render without hardcoded targets',()=>{
 const data=previewData();data.snapshots=[];data.flags=[];data.account.member!.flags_reviewed=false;data.account.member!.rank='moderator';const m=data.members.find(m=>m.id===data.account.member!.id)!;m.rank='moderator';m.flags_reviewed=false;data.settings.goals!.moderator!.requests=25;
 const html=renderToStaticMarkup(<Dashboard initial={data} preview/>);assert.ok(html.includes('لم تُراجع'));assert.ok(html.includes('metric-neutral'));assert.ok(html.includes('25 طلب'));assert.equal(html.includes('طلبات الأسبوع العشرون'),false);
});

test('v1.1 every operational section renders accessible Arabic markup without runtime failures',()=>{
 const data=previewData();for(const initialSection of ['members','accounts','reports','shifts','requests','discipline','meetings','notifications','profile','settings','rules','audit','history','points','helpers','moderators'] as const){const html=renderToStaticMarkup(<Dashboard initial={data} preview initialSection={initialSection}/>);assert.ok(html.includes('id="main"'));assert.ok(html.includes('معاينة'));}
});

test('v1.2 brand, role lists and ordinary dashboard expose no management UI or internal copy',()=>{
 const data=previewData();data.account={...data.account,owner:false,capabilities:[],member:{...data.account.member!,rank:'moderator'}};data.snapshots=data.snapshots.filter(s=>s.staff_id===data.account.member!.id);data.audit=[];data.accounts=[];data.member_scores=[];
 const html=renderToStaticMarkup(<Dashboard initial={data} preview/>);for(const text of ['Chico Admins','General Team','Top Helpers','Top Moderators','Helpers','Moderators'])assert.ok(html.includes(text));for(const text of ['مساحة تستحق','صلاحيات الحساب','Admin log','Accounts','تفاصيل السجل التقني','Team Hub'])assert.equal(html.includes(text),false);
 for(const initialSection of ['profile','requests','helpers','moderators'] as const){const view=renderToStaticMarkup(<Dashboard initial={data} preview initialSection={initialSection}/>);assert.ok(view.includes('id="main"'));}
});

test('v1.4 quick report action follows rank permissions even for an Owner Helper',()=>{
 for(const rank of ['helper','senior_helper','moderator'] as const){
  const data=previewData();data.account.member!.rank=rank;data.members.find(m=>m.id===data.account.member!.id)!.rank=rank;
  const html=renderToStaticMarkup(<Dashboard initial={data} preview/>);
  assert.equal(html.includes('Report جديد'),rank==='moderator');
  assert.ok(html.includes('Top Helpers'));assert.ok(html.includes('Top Moderators'));
 }
});

test('Login markup uses POST before hydration so passwords cannot enter the page URL',()=>{
 const html=renderToStaticMarkup(<AuthPanel configured/>);
 const form=html.match(/<form[^>]*>/)?.[0]??'';
 assert.match(form,/method="post"/);assert.match(form,/action="\/api\/login"/);
 assert.match(html,/<noscript>/);assert.match(html,/autoComplete="current-password"/);
});
