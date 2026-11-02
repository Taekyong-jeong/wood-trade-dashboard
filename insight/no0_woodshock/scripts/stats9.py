import pandas as pd,numpy as np,statsmodels.api as sm,warnings,json
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
m=pd.read_csv('merged2.csv',parse_dates=['ym']).set_index('ym')
dm=pd.read_csv('domestic.csv',parse_dates=['PRD_DE']).set_index('PRD_DE')
D=m.join(dm).loc['2016-01':'2024-12']; D['UVK']=D.P*D.EXKOUS; D['REL']=D.UVK/D.ppi_sawn
g=lambda s:np.log(s.rolling(3).mean()).diff(12)
D['gQ']=g(D.Q); D['gFX']=np.log(D.EXKOUS).diff(12)
for c in ['ship_wood','REL','UVK','ppi_sawn','done_bld']: D['g'+c]=g(D[c])
R={'ccf_ship':{k:round(D.gQ.corr(D.gship_wood.shift(k)),3) for k in range(-3,7)},'ccf_rel':{k:round(D.gQ.corr(D.gREL.shift(k)),3) for k in range(0,10)}}
def vm(terms,label):
    V=pd.concat([D.gQ]+[D['g'+c].shift(l).rename(f'{c}_l{l}') for c,l in terms],axis=1).dropna()
    r=sm.OLS(V.gQ,sm.add_constant(V.drop(columns='gQ'))).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    out={'n':int(r.nobs),'r2':round(r.rsquared,3),'adj':round(r.rsquared_adj,3),**{c:[round(r.params[c],3),round(r.pvalues[c],4)] for c in r.params.index if c!='const'}}
    for y in ['2021','2022','2023']:
        s=V.loc[y]; out['c'+y]={'actual':round(s.gQ.mean(),3),**{c:round((s[c]*r.params[c]).mean(),3) for c in r.params.index if c!='const'}}
    R[label]=out
vm([('FX',6)],'fx')
for l in [0,1,3]: vm([('FX',6),('ship_wood',l)],f'fx_ship{l}')
for l in [3,6]: vm([('FX',6),('ship_wood',0),('REL',l)],f'fx_ship0_rel{l}')
vm([('FX',6),('ship_wood',0),('done_bld',3)],'fx_ship0_bld3')
d=np.log(D[['Q','ship_wood']].rolling(3).mean()).diff().dropna()
t=grangercausalitytests(d[['Q','ship_wood']],maxlag=6); R['gr_ship_to_Q']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
t=grangercausalitytests(d[['ship_wood','Q']],maxlag=6); R['gr_Q_to_ship']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
# policy: legality verification 2018-10 / 2019-10 step dummies in fx+ship model (YoY growth -> use 12m window pulse)
for ev in ['2018-10-01','2019-10-01']:
    D['ev']=((D.index>=ev)&(D.index<pd.Timestamp(ev)+pd.DateOffset(months=12))).astype(float)
    V=pd.concat([D.gQ,D.gFX.shift(6).rename('fx'),D.gship_wood.rename('ship'),D.ev],axis=1).dropna()
    r=sm.OLS(V.gQ,sm.add_constant(V.drop(columns='gQ'))).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    R['policy_'+ev]={'coef':round(r.params['ev'],3),'p':round(r.pvalues['ev'],4),'n':int(r.nobs)}
json.dump(R,open('stats9_out.json','w'),ensure_ascii=False,indent=1); print(json.dumps(R,ensure_ascii=False))
