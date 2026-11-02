import json,numpy as np,pandas as pd,warnings,statsmodels.api as sm
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
M=pd.read_csv('merged.csv',index_col=0,parse_dates=True)
C=pd.read_csv('construction.csv',index_col=0,parse_dates=True)
D=M.join(C)
D['lQ3']=np.log(D.Q.rolling(3).mean()); D['gQ']=D.lQ3.diff(12)
for c in ['start_total','start_res','start_wood']:
    D['g_'+c]=np.log(D[c].rolling(3).mean()).diff(12)
D['gFX']=np.log(D.EXKOUS).diff(12); D['gP']=np.log(D.P).diff(12)
R={}
R['ccf_start']={c:{str(k):round(D.gQ.corr(D['g_'+c].shift(k)),3) for k in range(0,10)} for c in ['start_total','start_res','start_wood']}
best=None
for c in ['start_total','start_res']:
    for ls in [0,3,6]:
        for lf in [3,6]:
            V=pd.concat([D.gQ,D['g_'+c].shift(ls).rename('gS'),D.gFX.shift(lf).rename('gFX'),D.gP.shift(lf).rename('gP')],axis=1).dropna()
            m=sm.OLS(V.gQ,sm.add_constant(V[['gS','gFX','gP']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
            key=f'{c}_S{ls}_FX{lf}'
            R[key]={'n':int(m.nobs),'r2':round(m.rsquared,3),'adjr2':round(m.rsquared_adj,3),**{k:[round(m.params[k],3),round(m.pvalues[k],4)] for k in ['gS','gFX','gP']}}
            if best is None or m.rsquared_adj>best[1]: best=(key,m.rsquared_adj,m,V)
R['best']=best[0]
key,_,m,V=best
# contribution to 2022 YoY volume change (Dec 2022 yoy of 3mma) and annual
yr=V.loc['2022-01-01':'2022-12-01']
R['contrib_2022_avg_yoy']={'actual':round(yr.gQ.mean(),3),'start':round((yr.gS*m.params.gS).mean(),3),'fx':round((yr.gFX*m.params.gFX).mean(),3),'price':round((yr.gP*m.params.gP).mean(),3),'const':round(m.params.const,3)}
yr=V.loc['2023-01-01':'2023-12-01']
R['contrib_2023_avg_yoy']={'actual':round(yr.gQ.mean(),3),'start':round((yr.gS*m.params.gS).mean(),3),'fx':round((yr.gFX*m.params.gFX).mean(),3),'price':round((yr.gP*m.params.gP).mean(),3),'const':round(m.params.const,3)}
# Granger: monthly diff of log 3mma start -> Q
D['dQ']=D.lQ3.diff(); D['dS']=np.log(D.start_total.rolling(3).mean()).diff()
t=grangercausalitytests(D[['dQ','dS']].dropna().loc[:'2024-12-01'],maxlag=6)
R['granger_start_to_Q']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
json.dump(R,open('stats2_out.json','w'),ensure_ascii=False,indent=1)
print(json.dumps({k:R[k] for k in R if not k.startswith('start_')},ensure_ascii=False))
for k in R:
    if k.startswith('start_'): print(k,R[k])
