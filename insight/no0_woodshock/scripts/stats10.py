import pandas as pd,numpy as np,statsmodels.api as sm,warnings,json
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
m=pd.read_csv('merged2.csv',parse_dates=['ym']).set_index('ym')
c=pd.read_csv('construction.csv'); c.index=pd.to_datetime(c.PRD_DE)
dm=pd.read_csv('domestic.csv',parse_dates=['PRD_DE']).set_index('PRD_DE')
D=m.join(c[['start_total','start_res','start_wood']]).join(dm).loc['2016':'2024']; D['UVK']=D.P*D.EXKOUS
g=lambda s:np.log(s.rolling(3).mean()).diff(12)
for k in ['Q','UVK','P','ppi_sawn','start_total','start_wood','start_res','ship_wood','ppi_all']: D['g'+k]=g(D[k])
D['gFX']=np.log(D.EXKOUS).diff(12)
R={}
# Q1: import price -> volume
A=D.groupby(D.index.year).agg({'Q':'sum','UVK':'mean','P':'mean'}); R['annual_corr_Q_UVK']=round(A.Q.corr(A.UVK),2); R['annual_corr_Q_P']=round(A.Q.corr(A.P),2)
for pc in ['UVK','P']:
  for l in [0,3,6,9]:
    V=pd.concat([D.gQ,D.gFX.shift(6).rename('fx'),D['g'+pc].shift(l).rename('pr')],axis=1).dropna()
    r=sm.OLS(V.gQ,sm.add_constant(V[['fx','pr']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    r0=sm.OLS(V.gQ,sm.add_constant(V[['pr']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    R[f'Q_on_{pc}_l{l}']={'alone':[round(r0.params.pr,3),round(r0.pvalues.pr,3)],'withFX':[round(r.params.pr,3),round(r.pvalues.pr,3)]}
d=np.log(D[['Q','UVK','ppi_sawn','start_total','start_wood','start_res']].rolling(3).mean()).diff().dropna()
t=grangercausalitytests(d[['Q','UVK']],maxlag=6); R['gr_UVK_to_Q']={str(l):round(t[l][0]['ssr_ftest'][1],3) for l in t}
# Q3: wood price -> construction starts
for st in ['start_total','start_wood','start_res']:
  for pr in ['ppi_sawn','UVK']:
    t=grangercausalitytests(d[[st,pr]],maxlag=6); R[f'gr_{pr}_to_{st}']={str(l):round(t[l][0]['ssr_ftest'][1],3) for l in t}
    t=grangercausalitytests(d[[pr,st]],maxlag=6); R[f'gr_{st}_to_{pr}']={str(l):round(t[l][0]['ssr_ftest'][1],3) for l in t}
  for l in [0,3,6,9,12]:
    V=pd.concat([D['g'+st],D.gppi_sawn.shift(l).rename('w'),D.gppi_all.shift(l).rename('c')],axis=1).dropna()
    r=sm.OLS(V['g'+st],sm.add_constant(V[['w','c']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    r0=sm.OLS(V['g'+st],sm.add_constant(V[['w']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    R[f'{st}_on_ppisawn_l{l}']={'alone':[round(r0.params.w,3),round(r0.pvalues.w,3)],'with_ppi_all':[round(r.params.w,3),round(r.pvalues.w,3)],'ppi_all':[round(r.params.c,3),round(r.pvalues.c,3)]}
json.dump(R,open('stats10_out.json','w'),ensure_ascii=False,indent=0); print(json.dumps(R,ensure_ascii=False))
