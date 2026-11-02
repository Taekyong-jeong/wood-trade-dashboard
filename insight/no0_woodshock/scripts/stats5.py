import json,numpy as np,pandas as pd,warnings,statsmodels.api as sm
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
d=json.load(open('/home/claude/wood-trade-dashboard/data/external/kosis_macro.json'))
r=pd.DataFrame(d['광업제조업동향조사 생산지수']['rows']); r=r[r.C1_NM=='광공업']
IP=pd.Series(r.DT.astype(float).values,index=pd.to_datetime(r.PRD_DE,format='%Y%m')).sort_index()
x=pd.DataFrame(d['수출물량지수']['rows'])
print([c for c in x.C1_NM.unique() if '총' in c][:5])
x=x[(x.C1_NM.str.strip()=='총지수')&(x.UNIT_NM=='2020＝100')]
EX=pd.Series(x.DT.astype(float).values,index=pd.to_datetime(x.PRD_DE,format='%Y%m')).sort_index()
EX=EX[~EX.index.duplicated()]
M=pd.read_csv('merged2.csv',index_col=0,parse_dates=True)
D=M.join(IP.rename('IP')).join(EX.rename('EXV'))
print(D[['IP','EXV']].notna().sum().to_dict())
D['gQ']=np.log(D.Q.rolling(3).mean()).diff(12); D['gFX']=np.log(D.EXKOUS).diff(12)
for c in ['IP','EXV','done_bld']: D['g'+c]=np.log(D[c].rolling(3).mean()).diff(12)
R={}
R['ccf']={c:{str(k):round(D.gQ.corr(D['g'+c].shift(k)),3) for k in range(0,7)} for c in ['IP','EXV']}
def vm(cols,lags,label):
    V=pd.concat([D.gQ]+[D['g'+c].shift(l).rename(c) for c,l in zip(cols,lags)]+[D.gFX.shift(6).rename('gFX')],axis=1).dropna()
    m=sm.OLS(V.gQ,sm.add_constant(V.drop(columns='gQ'))).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    out={'n':int(m.nobs),'r2':round(m.rsquared,3),'adj':round(m.rsquared_adj,3),**{c:[round(m.params[c],3),round(m.pvalues[c],4)] for c in m.params.index if c!='const'}}
    for y in ['2022','2023']:
        s=V.loc[y]; out['contrib_'+y]={'actual':round(s.gQ.mean(),3),**{c:round((s[c]*m.params[c]).mean(),3) for c in m.params.index if c!='const'}}
    R[label]=out
vm([],[],'fx_only')
for l in [0,3]:
    vm(['IP'],[l],f'IP_l{l}'); vm(['EXV'],[l],f'EXV_l{l}')
vm(['IP','done_bld'],[0,3],'IP0_bld3'); vm(['EXV','done_bld'],[0,3],'EXV0_bld3')
D['dQ']=np.log(D.Q.rolling(3).mean()).diff()
for c in ['IP','EXV']:
    D['d'+c]=np.log(D[c].rolling(3).mean()).diff()
    t=grangercausalitytests(D[['dQ','d'+c]].dropna().loc[:'2024-12-01'],maxlag=6); R['granger_'+c]={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
json.dump(R,open('stats5_out.json','w'),ensure_ascii=False,indent=1)
print(json.dumps(R,ensure_ascii=False))
