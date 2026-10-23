"use client";
import {useState} from 'react';
import {ValueInput} from '@/components/ui/value-input';
import {Label} from '@/components/ui/label';
import {Slider} from '@/components/ui/slider';

const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
export function AmountRangeFilter({id,title,minValue,maxValue,onChange}:{id:string;title:string;minValue:string;maxValue:string;onChange:(min:string,max:string)=>void}){
 const [ceiling,setCeiling]=useState(10000);
 const number=(value:string)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
 const upperBound=Math.max(ceiling,Math.ceil(Math.max(number(minValue),number(maxValue))/1000)*1000);
 const min=number(minValue),max=maxValue===''?upperBound:number(maxValue);
 const invalid=min>max||[minValue,maxValue].some(value=>value!==''&&(!Number.isFinite(Number(value))||Number(value)<0));
 return <fieldset className="space-y-3 border-t pt-3">
  <legend className="text-sm font-medium">{title}</legend>
  <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{minValue===''?'Sem mínimo':currency.format(min)}</span><span>{maxValue===''?'Sem máximo':currency.format(max)}</span></div>
  <div className="px-2 py-2"><Slider min={0} max={upperBound} step={1} value={[Math.min(min,max),Math.max(min,max)]} disabled={invalid} onValueChange={([low,high])=>{setCeiling(upperBound);onChange(String(low),String(high));}}/></div>
  <div className="grid grid-cols-2 gap-3">
   <div className="space-y-2"><Label htmlFor={`${id}-min`}>Mínimo</Label><ValueInput id={`${id}-min`} allowEmpty placeholder="Sem limite" value={minValue===''?null:Number(minValue)} onEmpty={()=>onChange('',maxValue)} onValueChange={value=>{setCeiling(upperBound);onChange(String(value),maxValue);}}/></div>
   <div className="space-y-2"><Label htmlFor={`${id}-max`}>Máximo</Label><ValueInput id={`${id}-max`} allowEmpty placeholder="Sem limite" value={maxValue===''?null:Number(maxValue)} onEmpty={()=>onChange(minValue,'')} onValueChange={value=>{setCeiling(upperBound);onChange(minValue,String(value));}}/></div>
  </div>
  <p className="text-xs text-muted-foreground">Arraste para ajustar a faixa ou digite os valores exatos. Valores maiores ampliam a faixa.</p>
 </fieldset>;
}
