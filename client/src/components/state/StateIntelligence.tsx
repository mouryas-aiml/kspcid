'use client'

import DeckGL from '@deck.gl/react'
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Box, ChevronDown, DatabaseZap, ExternalLink, Layers3, MapPinned, Search, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { OpsShell } from '@/components/shell/OpsShell'
import { publicPath } from '@/lib/publicPath'
import { loadStateIntelligence, type Outlook, type StateDistrict, type StateIntelligenceData, type StateMode } from '@/lib/state'

export type GeoCollection = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: { district_id: string; district_name: string; center: [number, number] }; geometry: unknown }> }
const VIEW = { longitude: 76.2, latitude: 14.8, zoom: 5.55, pitch: 0, bearing: 0 }
const ALL = 'All registered crime'

function compact(value: number): string { return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function dateLabel(value: string): string { return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }
function modeValue(d: StateDistrict, mode: StateMode, outlook: Outlook): number { return mode === 'risk' ? outlook.risk.score : mode === 'rate' ? d.fir_rate_per_lakh : d.context.urban_share_pct }
function color(value: number, mode: StateMode, maximum: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, value / Math.max(maximum, 1)))
  if (mode === 'risk') return [Math.round(24 + 225 * t), Math.round(167 - 103 * t), Math.round(190 - 142 * t), 224]
  if (mode === 'rate') return [Math.round(32 + 212 * t), Math.round(123 + 55 * t), Math.round(170 - 96 * t), 220]
  return [Math.round(22 + 59 * t), Math.round(93 + 119 * t), Math.round(142 + 81 * t), 220]
}

function OutlookFor({ district, group }: { district: StateDistrict; group: string }): Outlook { return district.outlooks[group] ?? district.outlooks[ALL] ?? { history: district.history, forecast: district.forecast, forecast_4w: district.forecast_4w, risk: district.risk } }

function TrendChart({ outlook }: { outlook: Outlook }) {
  const observed = outlook.history; const forecast = outlook.forecast
  const values = [...observed.map((d) => d.value), ...forecast.map((d) => d.expected)]
  const maximum = Math.max(...values, 1); const width = 330; const height = 118; const gap = width / (values.length - 1)
  const points = values.map((value, index) => `${index * gap},${height - 10 - value / maximum * (height - 24)}`)
  return (
    <div className="state-trend" aria-label="Twelve observed weeks followed by four forecast weeks">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1="0" x2={width} y1={height - 10} y2={height - 10} stroke="var(--ink-500)" />
        <polyline points={points.slice(0, 12).join(' ')} fill="none" stroke="var(--cyan-400)" strokeWidth="2.4" />
        <polyline points={points.slice(11).join(' ')} fill="none" stroke="var(--gold-400)" strokeWidth="2.4" strokeDasharray="5 4" />
        {points.map((point, index) => { const [x, y] = point.split(','); return <circle key={index} cx={x} cy={y} r={index > 11 ? 3 : 2} fill={index > 11 ? 'var(--gold-400)' : 'var(--cyan-400)'} /> })}
      </svg>
      <div className="state-chart-key"><span><i className="observed" />Previous 12 weeks</span><span><i className="projected" />Next 4 weeks</span></div>
    </div>
  )
}

function ScoreComponents({ outlook }: { outlook: Outlook }) {
  const rows = [['Recent change', outlook.risk.components.recent_anomaly, '40%'], ['Four-week direction', outlook.risk.components.forecast_uplift, '35%'], ['Repeated pressure', outlook.risk.components.persistence, '25%']] as const
  return <div className="state-components">{rows.map(([label, value, weight]) => <div key={label}><div><span>{label}</span><small>{weight} · {value.toFixed(0)}</small></div><span className="state-bar"><i style={{ width: `${value}%` }} /></span></div>)}</div>
}

function ContextPanel({ data, mode, group, query, onMode, onGroup, onQuery }: { data: StateIntelligenceData; mode: StateMode; group: string; query: string; onMode: (m: StateMode) => void; onGroup: (g: string) => void; onQuery: (q: string) => void }) {
  return <div className="space-y-5">
    <label className="block"><span className="type-micro text-[--txt-3]">Find a district</span><span className="mt-2 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 text-[--txt-2]"><Search size={15}/><input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Search Karnataka" value={query} onChange={(e) => onQuery(e.target.value)} /></span></label>
    <fieldset><legend className="type-micro text-[--txt-3]">Map question</legend><div className="mt-2 grid gap-2">{([['risk','Where should we look next?'],['rate','Where are more FIRs registered?'],['urban','How urban is each district?']] as const).map(([value,label])=><button className="state-mode" data-active={mode===value} key={value} onClick={()=>onMode(value)} type="button"><span>{label}</span><small>{value==='risk'?'Risk Outlook':value==='rate'?'FIR rate per lakh':'Urban population share'}</small></button>)}</div></fieldset>
    <label className="block text-xs text-[--txt-3]">CRIME GROUP<span className="relative mt-2 block"><select aria-label="Crime group" className="w-full appearance-none rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 pr-8 text-[--txt]" value={group} onChange={(e)=>onGroup(e.target.value)}>{data.crime_groups.map((g)=><option key={g}>{g}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-2.5" size={14}/></span></label>
    <div className="state-proof"><p className="type-micro">STATEWIDE VIEW</p><strong>31</strong><span>current districts connected to one operational picture</span></div>
    <div><p className="type-micro text-[--txt-3]">Special statewide units</p><div className="mt-2 space-y-2">{data.special_units.map((unit)=><div className="flex justify-between text-xs" key={unit.name}><span>{unit.name}</span><span className="font-mono text-[--txt-2]">{compact(unit.registrations)}</span></div>)}</div></div>
  </div>
}

function InspectorPanel({ district, group }: { district: StateDistrict; group: string }) {
  const outlook = OutlookFor({ district, group })
  return <div className="space-y-5">
    <div className="state-risk-hero" data-band={outlook.risk.band}><div><span>{outlook.risk.score.toFixed(1)}</span><small>/ 100</small></div><div><p>{outlook.risk.band}</p><span>District Risk Outlook</span></div></div>
    <ScoreComponents outlook={outlook}/>
    <section><div className="flex items-end justify-between"><div><p className="type-micro text-[--txt-3]">NEXT FOUR WEEKS</p><strong className="text-2xl text-[--txt-hi]">{outlook.forecast_4w.expected}</strong><span className="ml-2 text-xs text-[--txt-3]">expected registrations</span></div><span className="text-xs text-[--txt-2]">{outlook.forecast_4w.low}–{outlook.forecast_4w.high}</span></div><TrendChart outlook={outlook}/><div className="grid grid-cols-4 gap-2">{outlook.forecast.map((week)=><div className="state-week" key={week.week}><span>{dateLabel(week.week)}</span><strong>{week.expected.toFixed(1)}</strong></div>)}</div></section>
    <div className="grid grid-cols-3 gap-2"><div className="state-mini"><span>FIRs / lakh</span><strong>{district.fir_rate_per_lakh.toLocaleString('en-IN')}</strong></div><div className="state-mini"><span>People / km²</span><strong>{district.context.density_per_sq_km.toLocaleString('en-IN')}</strong></div><div className="state-mini"><span>Urban share</span><strong>{district.context.urban_share_pct}%</strong></div></div>
    <section><p className="type-micro text-[--txt-3]">What is emerging</p><div className="mt-2 space-y-2">{district.top_emerging_categories.map((item)=><div className="state-emerging" key={item.crime_group}><span>{item.crime_group}</span><strong>{item.score.toFixed(0)}</strong></div>)}</div></section>
    <section><p className="type-micro text-[--txt-3]">Police-unit contribution</p><div className="mt-2 space-y-2">{district.police_units.map((unit)=><div className="flex justify-between text-xs" key={unit.name}><span>{unit.name}</span><span className="font-mono text-[--txt-2]">{compact(unit.registrations)}</span></div>)}</div></section>
    {district.name==='Bengaluru Urban'?<Link className="state-cta" href="/map/"><span><MapPinned size={17}/>Open Bengaluru Command</span><ExternalLink size={15}/></Link>:null}
  </div>
}

export function StateIntelligence({ initialData, initialGeo }: { initialData: StateIntelligenceData; initialGeo: GeoCollection }) {
  const [data,setData]=useState<StateIntelligenceData|null>(initialData), [geo,setGeo]=useState<GeoCollection|null>(initialGeo)
  const [selected,setSelected]=useState(initialData.districts[0]?.district_id??''), [mode,setMode]=useState<StateMode>('risk'), [group,setGroup]=useState(ALL), [query,setQuery]=useState(''), [threeD,setThreeD]=useState(false), [live,setLive]=useState(false)
  const [pulse,setPulse]=useState(false)
  const reduce=useReducedMotion()
  useEffect(()=>{const c=new AbortController(); Promise.all([loadStateIntelligence(c.signal),fetch(publicPath('/data/reference/karnataka_districts.geojson'),{signal:c.signal}).then(async r=>{if(!r.ok)throw new Error(`District geometry HTTP ${r.status}`);return r.json() as Promise<GeoCollection>})]).then(([loaded,geometry])=>{setData(loaded.data);setLive(loaded.live);setGeo(geometry);setSelected(current=>current||loaded.data.districts[0]?.district_id||'')}).catch(()=>{ /* Embedded checked data keeps the screen operational. */ });return()=>c.abort()},[])
  useEffect(()=>{if(reduce)return;const timer=window.setInterval(()=>setPulse(value=>!value),900);return()=>window.clearInterval(timer)},[reduce])
  const districtMap=useMemo(()=>new Map(data?.districts.map(d=>[d.district_id,d])??[]),[data])
  const selectedDistrict=districtMap.get(selected)??data?.districts[0]
  const maximum=useMemo(()=>data?Math.max(...data.districts.map(d=>modeValue(d,mode,OutlookFor({district:d,group})))):100,[data,mode,group])
  const priorities=useMemo(()=>data?[...data.districts].filter(d=>d.outlooks[group]).sort((a,b)=>OutlookFor({district:b,group}).risk.score-OutlookFor({district:a,group}).risk.score).slice(0,5):[],[data,group])
  const filtered=useMemo(()=>data?.districts.filter(d=>d.name.toLowerCase().includes(query.toLowerCase())).slice(0,6)??[],[data,query])
  const layer=useMemo(()=>!geo||!data?[]:[new GeoJsonLayer({id:`state-districts-${threeD?'3d':'2d'}`,data:geo as never,pickable:true,stroked:true,filled:true,extruded:threeD,getElevation:(f:any)=>{const d=districtMap.get(f.properties.district_id);return d?OutlookFor({district:d,group}).risk.score*220:0},getFillColor:(f:any)=>{const d=districtMap.get(f.properties.district_id);if(!d)return[30,40,52,180];const o=OutlookFor({district:d,group});return color(modeValue(d,mode,o),mode,maximum)},getLineColor:(f:any)=>f.properties.district_id===selected?[255,197,61,255]:[178,205,223,155],getLineWidth:(f:any)=>f.properties.district_id===selected?3:1,lineWidthMinPixels:1,material:threeD?{ambient:1,diffuse:0,shininess:0,specularColor:[0,0,0]}:false,onClick:(info:PickingInfo)=>{const id=(info.object as any)?.properties?.district_id;if(id)setSelected(id)}}),new ScatterplotLayer({id:`priority-pulses-${threeD?'3d':'2d'}`,data:geo.features.filter(f=>priorities.some(d=>d.district_id===f.properties.district_id)),getPosition:(f:any)=>f.properties.center,getRadius:pulse?22000:9000,radiusMinPixels:pulse?12:6,radiusMaxPixels:28,filled:false,stroked:true,getLineColor:[255,197,61,pulse?45:180],getLineWidth:2,lineWidthMinPixels:1,transitions:reduce?undefined:{getRadius:850,getLineColor:850}})], [geo,data,threeD,districtMap,group,mode,maximum,selected,reduce,priorities,pulse])

  if(!data||!geo||!selectedDistrict)return <div className="grid h-screen place-items-center bg-[--ink-850] text-[--txt-2]"><DatabaseZap className="animate-pulse"/>Building the statewide picture…</div>
  return <OpsShell title="State Intelligence" eyebrow="KARNATAKA COMMAND" context={<ContextPanel data={data} mode={mode} group={group} query={query} onMode={setMode} onGroup={setGroup} onQuery={setQuery}/>} inspector={<InspectorPanel district={selectedDistrict} group={group}/>} inspectorTitle={selectedDistrict.name} inspectorEyebrow="DISTRICT INSPECTOR">
    <div className="state-canvas">
      <DeckGL key={threeD?'state-3d':'state-2d'} initialViewState={{...VIEW,pitch:threeD?45:0,bearing:threeD?-14:0}} controller layers={layer} getTooltip={({object}:any)=>{if(!object)return null;const d=districtMap.get(object.properties.district_id);if(!d)return null;const o=OutlookFor({district:d,group});return {html:`<b>${d.name}</b><br/>${mode==='risk'?`Risk Outlook ${o.risk.score.toFixed(1)} · ${o.risk.band}`:mode==='rate'?`${d.fir_rate_per_lakh.toLocaleString('en-IN')} FIRs per lakh`:`${d.context.urban_share_pct}% urban`}<br/><span>${d.top_emerging_categories[0]?.crime_group??group}</span>`,style:{background:'#10161F',color:'#E2E8F0',border:'1px solid #2B3849',borderRadius:'8px',fontSize:'12px',padding:'10px'}}}} />
      <div className="state-topbar"><div><p className="type-micro">{mode==='risk'?'FOUR-WEEK DISTRICT RISK OUTLOOK':mode==='rate'?'REGISTRATIONS NORMALIZED BY POPULATION':'URBANIZATION CONTEXT'}</p><h2>{group}</h2></div><div className="flex items-center gap-2"><span className="state-live" data-live={live}><i/>{live?'Catalyst live':'Checked snapshot'}</span><button className="state-3d" data-active={threeD} onClick={()=>setThreeD(v=>!v)} type="button"><Box size={16}/>{threeD?'Return to 2D':'Command Room 3D'}</button></div></div>
      <div className="state-rank"><p className="type-micro">PRIORITY FIVE</p>{priorities.map((d,index)=><button data-active={d.district_id===selected} key={d.district_id} onClick={()=>setSelected(d.district_id)}><span>{index+1}</span><strong>{d.name}</strong><em>{OutlookFor({district:d,group}).risk.score.toFixed(1)}</em></button>)}</div>
      <AnimatePresence>{query&&filtered.length?<motion.div className="state-search-results" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>{filtered.map(d=><button key={d.district_id} onClick={()=>{setSelected(d.district_id);setQuery('')}}><span>{d.name}</span><strong>{OutlookFor({district:d,group}).risk.score.toFixed(1)}</strong></button>)}</motion.div>:null}</AnimatePresence>
      <div className="state-legend"><Layers3 size={14}/><span>Lower</span><i/><span>Higher</span><small>{threeD?'height = outlook score':'select a district for detail'}</small></div>
      <div className="state-story"><ShieldCheck size={16}/><span><strong>{data.state_summary.source_rows.toLocaleString('en-IN')}</strong> FIR rows shaped into one district command view</span></div>
    </div>
  </OpsShell>
}
