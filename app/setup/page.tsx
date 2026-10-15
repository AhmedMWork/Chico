import {redirect} from 'next/navigation';
import {getSession} from '@/lib/auth/session';
import SetupOwner from '@/components/setup-owner';
export const dynamic='force-dynamic';
export default async function Setup(){try{await getSession();return <SetupOwner/>;}catch{redirect('/');}}
