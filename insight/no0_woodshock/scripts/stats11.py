import pandas as pd,numpy as np,statsmodels.api as sm,warnings,json
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
d=json.load(open('/home/claude/wood-trade-dashboard/data/external/kosis_rates.json'))
def S(t,c1,unit=None):
    r=pd.DataFrame(d[t]['rows']); r=r[r.C1_NM.str.strip()==c1]
    r=r[~r.PRD_DE.duplicated()]
    return pd.Series(r.DT.astype(float).values,index=pd.to_datetime(r.PRD_DE,format='%Y%m')).sort_index()
rate=S('DT_121Y006','주택담보대출'); cost=S('DT_39701_A003','주거용건물'); costb=S('DT_39701_A003','건설')
m=pd.read_csv('merged2.csv',parse_dates=['ym']).set_index('ym')
c=pd.read_csv('construction.csv'); c.index=pd.to_datetime(c.PRD_DE)
dm=pd.read_csv('domestic.csv',parse_dates=['PRD_DE']).set_index('PRD_DE')
D=m.join(c[['start_total','start_res','start_wood']]).join(dm).join(rate.rename('rate')).join(cost.rename('cost')).join(costb.rename('costb')).loc['2016':'2024']
print(D[['rate','cost']].loc['2020':'2023':6])
g=lambda s:np.log(s.rolling(3).mean()).diff(12)
for k in ['start_total','start_res','start_wood','ppi_sawn','cost','costb','Q']: D['g'+k]=g(D[k])
D['drate']=D.rate.rolling(3).mean().diff(12)  # %p change YoY
R={'rate_2021_min':float(D.rate.loc['2021'].min()),'rate_2023_max':float(D.rate.loc['2022':'2023'].max()),
   'cost_2020':round(D.cost.loc['2020'].mean(),1),'cost_2023':round(D.cost.loc['2023'].mean(),1)}
for st in ['start_total','start_res','start_wood']:
  for l in [3,6,9,12]:
    V=pd.concat([D['g'+st],D.drate.shift(l).rename('rate'),D.gcost.shift(l).rename('cost'),D.gppi_sawn.shift(l).rename('wood')],axis=1).dropna()
    r=sm.OLS(V['g'+st],sm.add_constant(V[['rate','cost','wood']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    out={'n':int(r.nobs),'r2':round(r.rsquared,3),**{k:[round(r.params[k],3),round(r.pvalues[k],4)] for k in ['rate','cost','wood']}}
    s=V.loc['2022-07':'2023-12']; act=s['g'+st].mean()
    out['contrib_2022H2_2023']={'actual':round(act,3),**{k:round((s[k]*r.params[k]).mean(),3) for k in ['rate','cost','wood']}}
    R[f'{st}_l{l}']=out
dd=pd.DataFrame({'st':np.log(D.start_total.rolling(3).mean()).diff(),'stw':np.log(D.start_wood.rolling(3).mean()).diff(),'rate':D.rate.diff(),'wood':np.log(D.ppi_sawn).diff(),'cost':np.log(D.cost).diff()}).dropna()
for a in ['st','stw']:
  for b in ['rate','wood','cost']:
    t=grangercausalitytests(dd[[a,b]],maxlag=12); R[f'gr_{b}_to_{a}']={str(l):round(t[l][0]['ssr_ftest'][1],3) for l in [3,6,9,12]}
json.dump(R,open('stats11_out.json','w'),ensure_ascii=False,indent=0); print(json.dumps(R,ensure_ascii=False))
