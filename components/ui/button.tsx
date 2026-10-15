import * as React from 'react';
export function Button({asChild=false,variant='default',className='',children,...props}:React.ComponentProps<'button'>&{asChild?:boolean;variant?:string;size?:string}){
 const classes='button '+(variant==='outline'?'outline':'gold')+' '+className;
 if(asChild&&React.isValidElement<{className?:string}>(children))return React.cloneElement(children,{className:classes+' '+(children.props.className??'')});
 return <button className={classes} {...props}>{children}</button>;
}
