import Dashboard from '@/components/dashboard';
import {previewData} from '@/lib/domain/preview';
export const dynamic='force-dynamic';
export default async function PreviewPage({searchParams}:{searchParams:Promise<{view?:string}>}){const params=await searchParams;return <Dashboard initial={previewData()} preview initialSection={(['personal','team','members','accounts','reports','shifts','requests','discipline','meetings','notifications','profile','settings','rules','audit','history','points','helpers','moderators'] as const).find(view=>view===params.view)??'personal'}/>;}
