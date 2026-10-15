import type {Metadata,Viewport} from 'next';
import './globals.css';
export const metadata:Metadata={title:{default:'Chico Admins | إدارة الفريق',template:'%s | Chico Admins'},description:'نظام إدارة فريق شيكو: متابعتك وإحصائياتك ومناوباتك، في مساحة منظمة.',icons:{icon:'/assets/chico.png'},robots:{index:false,follow:false}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#08090b'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ar" dir="rtl" data-theme="dark"><body><a href="#main" className="skip-link">انتقل إلى المحتوى</a>{children}</body></html>;}
