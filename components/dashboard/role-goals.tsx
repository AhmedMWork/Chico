import {Headphones,Shield,Flag,Ticket,Clock3,Star,ClipboardCheck} from 'lucide-react';
import type {DataBundle} from '@/lib/domain/types';
import {goals} from '@/lib/domain/rules';
export default function RoleGoals({data}:{data:DataBundle}){
 const helper=goals('helper',data.settings)!,moderator=goals('moderator',data.settings)!;
 return <details className="role-goals-disclosure"><summary><span><Shield size={19}/> أهداف الرتب وحدود Flags</span><span className="goals-summary-hint">Role targets</span></summary><div className="role-goals-grid">
  <section className="card role-goal-card role-helper"><header><Headphones size={22}/><div><span>WEEKLY TARGET</span><h2 dir="ltr">Helper</h2></div></header><dl><div><dt><Ticket size={16}/> Tickets</dt><dd>{helper.tickets}</dd></div><div><dt><Clock3 size={16}/> Hours</dt><dd>{helper.hours}</dd></div><div><dt><Star size={16}/> Rating</dt><dd>{helper.rating}</dd></div></dl></section>
  <section className="card role-goal-card role-moderator"><header><Shield size={22}/><div><span>WEEKLY TARGET</span><h2 dir="ltr">Moderator</h2></div></header><dl><div><dt><Ticket size={16}/> Tickets</dt><dd>{moderator.tickets}</dd></div><div><dt><Clock3 size={16}/> Hours</dt><dd>{moderator.hours}</dd></div><div><dt><Star size={16}/> Rating</dt><dd>{moderator.rating}</dd></div><div><dt><ClipboardCheck size={16}/> Requests</dt><dd>{moderator.requests??'—'}</dd></div><div><dt><ClipboardCheck size={16}/> Complaints</dt><dd>{moderator.complaints??'—'}</dd></div></dl></section>
  <section className="card role-goal-card role-status"><header><Flag size={22}/><div><span>FOLLOW UP</span><h2>Flags</h2></div></header><div className="status-bands"><div className="status-normal"><i/><strong>0–6</strong><span>ضمن الحد</span></div><div className="status-watch"><i/><strong>7–9</strong><span>متابعة</span></div><div className="status-training"><i/><strong>10+</strong><span>تدريب</span></div></div><p>Flags تفضل محفوظة في السجل.</p></section>
 </div></details>;
}
