import {redirect} from 'next/navigation';
import AuthPanel from '@/components/auth-panel';
import {isConfigured} from '@/lib/db/supabase';
import {getSession} from '@/lib/auth/session';
export const dynamic='force-dynamic';
export default async function Home(){
 const configured=isConfigured();
 if(configured){try{await getSession();redirect('/app');}catch(error){if(error instanceof Error&&error.message.startsWith('NEXT_REDIRECT'))throw error;}}
 return <AuthPanel configured={configured}/>;
}
