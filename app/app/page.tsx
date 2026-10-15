import {redirect} from 'next/navigation';
import {AppError,rpc} from '@/lib/db/supabase';
import {getSession} from '@/lib/auth/session';
import PendingPanel from '@/components/pending-panel';
import Dashboard from '@/components/dashboard';
import ServiceUnavailable from '@/components/service-unavailable';
import {weekDate} from '@/lib/domain/rules';
import type {DataBundle} from '@/lib/domain/types';
export const dynamic='force-dynamic';
export default async function AppPage(){
 try{const session=await getSession();if(session.account.status!=='active')return <PendingPanel account={session.account}/>;
  const data=await rpc<DataBundle>('chico_dashboard',{p_period:weekDate()},session.token);return <Dashboard initial={data}/>;
 }catch(error){if(error instanceof AppError&&[502,503].includes(error.status))return <ServiceUnavailable/>;if(error instanceof AppError&&[401,403].includes(error.status))redirect('/');throw error;}
}
