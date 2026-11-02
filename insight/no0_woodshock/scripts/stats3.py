import json,csv,numpy as np,pandas as pd,warnings,statsmodels.api as sm
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
X='/home/claude/wood-trade-dashboard/data/external/'
M=pd.read_csv('merged.csv',index_col=0,parse_dates=True)
# Eurostat
d=json.load(open(X+'eurostat_ppi_c161.json'))
dims=d['id']; size=d['size']; idx={k:d['dimension'][k]['category']['index'] for k in dims}
def eu(geo,unit='I21'):
    out={}
    for t,ti in idx['time'].items():
        pos=[0]*len(dims)
        for j,k in enumerate(dims):
            pos[j]={'time':ti,'geo':idx['geo'][geo],'unit':idx['unit'][unit]}.get(k,0)
        flat=0
        for j in range(len(dims)): flat=flat*size[j]+pos[j]
        v=d['value'].get(str(flat))
        if v is not None: out[pd.to_datetime(t)]=v
    return pd.Series(out,dtype=float).sort_index()
E=pd.DataFrame({g:eu(g) for g in ['EU27_2020','DE','SE','FI','AT','LV']}); E.index=pd.to_datetime(E.index); print('nonnull',E.notna().sum().to_dict())
print(E.loc['2020-01-01':'2023-12-01'].resample('YS').mean().round(1))
# StatCan
rows=list(csv.DictReader(open(X+'statcan_lumber.csv')))
sc={}
for r in rows:
    k=r['North American Product Classification System (NAPCS)']
    if k in ('Total softwood, production [24112]','Total softwood, stocks [24112]') and r['VALUE']:
        sc.setdefault(k,{})[pd.to_datetime(r['REF_DATE'])]=float(r['VALUE'])
S=pd.DataFrame(sc).rename(columns={'Total softwood, production [24112]':'ca_prod','Total softwood, stocks [24112]':'ca_stock'})
# construction done
c=json.load(open(X+'kosis_construction_done.json'))['DT_1G18011']['rows']
cd=pd.DataFrame(c); cd['t']=pd.to_datetime(cd.PRD_DE,format='%Y%m'); cd['DT']=cd.DT.astype(float)
K=cd.pivot_table(index='t',columns='C1_NM',values='DT')
K.columns=['done_'+{'계':'total','건축':'bld','토목':'civil'}[c.strip()] for c in K.columns]
D=M.join(E['EU27_2020'].rename('EU')).join(S).join(K)
D.to_csv('merged2.csv')
D['dP']=np.log(D.P).diff(); D['dL']=np.log(D.WPU0811).diff(); D['dE']=np.log(D.EU).diff(); D['dG']=D.GSCPI.diff(); D['dFX']=np.log(D.EXKOUS).diff()
R={}
R['ccf_dE']={str(k):round(D.dP.corr(D.dE.shift(k)),3) for k in range(0,9)}
def fit(use_E=True):
    Z=pd.DataFrame({f'dL{l}':D.dL.shift(l) for l in range(7)})
    for l in range(4): Z[f'dG{l}']=D.dG.shift(l)
    if use_E:
        for l in range(4): Z[f'dE{l}']=D.dE.shift(l)
    Z['dFX']=D.dFX
    MM=pd.concat([D.dP,Z],axis=1).dropna()
    m=sm.OLS(MM.dP,sm.add_constant(MM.drop(columns='dP'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
    return m,MM
m0,M0=fit(False); m1,M1=fit(True)
R['base']={'n':int(m0.nobs),'r2':round(m0.rsquared,3),'adj':round(m0.rsquared_adj,3)}
R['withEU']={'n':int(m1.nobs),'r2':round(m1.rsquared,3),'adj':round(m1.rsquared_adj,3),'coefE':{c:[round(m1.params[c],3),round(m1.pvalues[c],4)] for c in m1.params.index if c.startswith('dE')}}
Ec=[f'dE{l}' for l in range(4)]
w=m1.wald_test(' + '.join(Ec)+' = 0',scalar=True); R['lr_E']=[round(sum(m1.params[c] for c in Ec),3),round(float(w.pvalue),5)]
R['joint_E_p']=round(float(m1.f_test(', '.join(f'{c}=0' for c in Ec)).pvalue),5)
Lc=[f'dL{l}' for l in range(7)]; Gc=[f'dG{l}' for l in range(4)]
R['joint_L_p_withEU']=round(float(m1.f_test(', '.join(f'{c}=0' for c in Lc)).pvalue),5)
R['joint_G_p_withEU']=round(float(m1.f_test(', '.join(f'{c}=0' for c in Gc)).pvalue),5)
for nm,(m,MM) in {'base':(m0,M0),'withEU':(m1,M1)}.items():
    per=MM.loc['2021-01-01':'2021-10-01']; act=per.dP.sum()
    parts={'lumber':sum((per[c]*m.params[c]).sum() for c in Lc),'gscpi':sum((per[c]*m.params[c]).sum() for c in Gc)}
    if nm=='withEU': parts['eu']=sum((per[c]*m.params[c]).sum() for c in Ec)
    parts['fx_const']=(per.dFX*m.params.dFX).sum()+m.params.const*len(per)
    parts['resid']=act-sum(parts.values())
    R['contrib_'+nm]={k:[round(v,3),round(v/act*100,1)] for k,v in parts.items()}; R['contrib_'+nm]['actual']=round(act,3)
t=grangercausalitytests(D[['dP','dE']].dropna(),maxlag=6); R['granger_E_to_P']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
# Canada supply: YoY production growth -> lumber price / KR price
D['gCA']=np.log(D.ca_prod.rolling(3).mean()).diff(12); D['gL']=np.log(D.WPU0811).diff(12)
R['ccf_caprod_USprice']={str(k):round(D.gL.corr(D.gCA.shift(k)),3) for k in range(0,7)}
D['dCA']=np.log(D.ca_prod).diff(12).diff()
# volume with construction done
D['gQ']=np.log(D.Q.rolling(3).mean()).diff(12); D['gFX']=np.log(D.EXKOUS).diff(12)
for col in ['done_total','done_bld']:
    D['g_'+col]=np.log(D[col].rolling(3).mean()).diff(12)
    for ls in [0,3,6]:
        V=pd.concat([D.gQ,D['g_'+col].shift(ls).rename('gS'),D.gFX.shift(6).rename('gFX')],axis=1).dropna()
        v=sm.OLS(V.gQ,sm.add_constant(V[['gS','gFX']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
        R[f'vol_{col}_S{ls}']={'n':int(v.nobs),'r2':round(v.rsquared,3),'gS':[round(v.params.gS,3),round(v.pvalues.gS,4)],'gFX':[round(v.params.gFX,3),round(v.pvalues.gFX,4)]}
D['dQ']=np.log(D.Q.rolling(3).mean()).diff(); D['dB']=np.log(D.done_bld.rolling(3).mean()).diff()
t=grangercausalitytests(D[['dQ','dB']].dropna(),maxlag=6); R['granger_doneBld_to_Q']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
json.dump(R,open('stats3_out.json','w'),ensure_ascii=False,indent=1)
print(json.dumps(R,ensure_ascii=False))
