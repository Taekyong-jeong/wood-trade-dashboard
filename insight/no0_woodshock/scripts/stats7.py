import pandas as pd,numpy as np,statsmodels.api as sm,warnings,json
from statsmodels.tsa.stattools import grangercausalitytests,coint,adfuller
warnings.filterwarnings('ignore')
m=pd.read_csv('merged2.csv',parse_dates=['ym']).set_index('ym')
dm=pd.read_csv('domestic.csv',parse_dates=['PRD_DE']).set_index('PRD_DE')
D=m.join(dm).loc['2016-01':'2024-12']
D['UVK']=D.P*D.EXKOUS
R={}
def lvl(s,y): return s.loc[y].mean()
for c in ['UVK','P','ppi_sawn','imp_sawn_krw','imp_sawn_usd','ppi_ply','ppi_pallet','ppi_all']:
    s=D[c]; b=lvl(s,'2020'); pk=s.loc['2021':'2022'].idxmax()
    R[c]={'peak':f'{pk:%Y-%m}','peak_pct':round((s.max()/b-1)*100,1),'y2023':round((lvl(s,'2023')/b-1)*100,1),'y2024':round((lvl(s,'2024')/b-1)*100,1),
          'first10':f"{s[(s/b-1)>0.10].loc['2020':].index.min():%Y-%m}"}
# extended domestic to 2026
full=dm.ppi_sawn; R['ppi_sawn_2026_09_vs2020']=round((full.iloc[-1]/full.loc['2020'].mean()-1)*100,1); R['ppi_sawn_last']=str(full.index[-1].date())
d=np.log(D[['UVK','ppi_sawn','ppi_all','imp_sawn_krw']]).diff()
R['ccf_UVK_to_ppi']={k:round(d.ppi_sawn.corr(d.UVK.shift(k)),3) for k in range(0,9)}
R['ccf_impidx_to_ppi']={k:round(d.ppi_sawn.corr(d.imp_sawn_krw.shift(k)),3) for k in range(0,9)}
L=6
X=pd.DataFrame({f'u{k}':d.UVK.shift(k) for k in range(L+1)}); X['pall']=d.ppi_all
for k in (1,): X[f'y{k}']=d.ppi_sawn.shift(k)
V=pd.concat([d.ppi_sawn.rename('y'),X],axis=1).dropna()
r=sm.OLS(V.y,sm.add_constant(V.drop(columns='y'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
s=sum(r.params[f'u{k}'] for k in range(L+1)); lr=s/(1-r.params['y1'])
w=r.wald_test(' + '.join(f'u{k}' for k in range(L+1))+' = 0',scalar=True)
R['passthrough']={'n':int(r.nobs),'r2':round(r.rsquared,3),'short_sum':round(s,3),'long_run':round(lr,3),'p':float(w.pvalue),
  'coefs':{k:[round(r.params[f'u{k}'],3),round(r.pvalues[f'u{k}'],3)] for k in range(L+1)},'pall':[round(r.params['pall'],3),round(r.pvalues['pall'],3)],'y1':round(r.params['y1'],3)}
# asymmetry
up=d.UVK.clip(lower=0); dn=d.UVK.clip(upper=0)
X=pd.DataFrame({**{f'p{k}':up.shift(k) for k in range(L+1)},**{f'n{k}':dn.shift(k) for k in range(L+1)}}); X['pall']=d.ppi_all; X['y1']=d.ppi_sawn.shift(1)
V=pd.concat([d.ppi_sawn.rename('y'),X],axis=1).dropna()
r2=sm.OLS(V.y,sm.add_constant(V.drop(columns='y'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
sp=sum(r2.params[f'p{k}'] for k in range(L+1)); sn=sum(r2.params[f'n{k}'] for k in range(L+1))
wa=r2.wald_test(' + '.join(f'p{k}' for k in range(L+1))+' - '+' - '.join(f'n{k}' for k in range(L+1))+' = 0',scalar=True)
wp=r2.wald_test(' + '.join(f'p{k}' for k in range(L+1))+' = 0',scalar=True); wn=r2.wald_test(' + '.join(f'n{k}' for k in range(L+1))+' = 0',scalar=True)
R['asym']={'up_sum':round(sp,3),'up_p':float(wp.pvalue),'down_sum':round(sn,3),'down_p':float(wn.pvalue),'diff_p':float(wa.pvalue),'r2':round(r2.rsquared,3)}
# granger
g=d[['ppi_sawn','UVK']].dropna(); t=grangercausalitytests(g,maxlag=6,verbose=False) if False else grangercausalitytests(g,maxlag=6)
R['granger_UVK_to_ppi']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
t=grangercausalitytests(d[['UVK','ppi_sawn']].dropna(),maxlag=6); R['granger_ppi_to_UVK']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
lg=np.log(D[['ppi_sawn','UVK']]).dropna(); R['coint_p']=round(coint(lg.ppi_sawn,lg.UVK)[1],3)
# window decomposition: 2021-01..2022-04 rise, 2022-05..2024-12 fall: predicted vs actual from symmetric model
for a,b in [('2021-01','2021-10'),('2021-01','2022-04'),('2022-05','2024-12')]:
    w_=V.loc[a:b]; R[f'win_{a}_{b}']={'actual_ppi':round(np.expm1(d.ppi_sawn.loc[a:b].sum())*100,1),'UVK':round(np.expm1(d.UVK.loc[a:b].sum())*100,1)}
json.dump(R,open('stats7_out.json','w'),ensure_ascii=False,indent=1,default=str); print(json.dumps(R,ensure_ascii=False,indent=1,default=str))
