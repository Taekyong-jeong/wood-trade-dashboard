import pandas as pd,numpy as np,statsmodels.api as sm,warnings,json
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
m=pd.read_csv('merged2.csv',parse_dates=['ym']).set_index('ym')
dm=pd.read_csv('domestic.csv',parse_dates=['PRD_DE']).set_index('PRD_DE')
D=m.join(dm).loc['2016-01':'2024-12']; D['UVK']=D.P*D.EXKOUS
d=np.log(D[['ppi_sawn','EU','WPU0811','EXKOUS','ppi_all','UVK']]).diff(); d['G']=D.GSCPI.diff()
R={}
for c in ['EU','WPU0811']:
    R['ccf_'+c]={k:round(d.ppi_sawn.corr(d[c].shift(k)),3) for k in range(0,8)}
    t=grangercausalitytests(d[['ppi_sawn',c]].dropna(),maxlag=6); R['gr_'+c+'_to_ppi']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
    t=grangercausalitytests(d[[c,'ppi_sawn']].dropna(),maxlag=6); R['gr_ppi_to_'+c]={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
def model(spec,label):
    X=pd.DataFrame({f'{c}{k}':d[c].shift(k) for c,ks in spec.items() for k in ks}); X['y1']=d.ppi_sawn.shift(1)
    V=pd.concat([d.ppi_sawn.rename('y'),X],axis=1).dropna()
    r=sm.OLS(V.y,sm.add_constant(V.drop(columns='y'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
    out={'n':int(r.nobs),'r2':round(r.rsquared,3),'adj':round(r.rsquared_adj,3)}
    for c,ks in spec.items():
        names=[f'{c}{k}' for k in ks]; s=sum(r.params[n] for n in names)
        out[c]=[round(s,3),round(s/(1-r.params['y1']),3),float(r.wald_test(' + '.join(names)+' = 0',scalar=True).pvalue)]
    # contributions (with y1 dynamics via simulation) for windows
    for a,b in [('2021-01','2022-06'),('2022-07','2024-12')]:
        idx=V.loc[a:b].index; act=V.y.loc[idx].sum(); contr={}
        for c,ks in spec.items():
            contr[c]=sum((V.loc[idx,f'{c}{k}']*r.params[f'{c}{k}']).sum() for k in ks)
        # rough dynamic multiplier
        contr={c:round(v/(1-r.params['y1'])/act,2) for c,v in contr.items()}
        out[f'{a}_{b}']={'actual_log':round(act,3),**contr}
    R[label]=out
model({'EU':range(0,4),'WPU0811':range(0,5),'EXKOUS':range(0,3),'ppi_all':[0],'G':range(0,4)},'full')
model({'EU':range(0,4),'EXKOUS':range(0,3),'ppi_all':[0]},'eu_fx_cost')
# real domestic price
real=np.log(D.ppi_sawn/D.ppi_all); R['real_2023_vs2020']=round((np.exp(real.loc['2023'].mean()-real.loc['2020'].mean())-1)*100,1); R['real_2024']=round((np.exp(real.loc['2024'].mean()-real.loc['2020'].mean())-1)*100,1)
full=dm.ppi_sawn/dm.ppi_all; R['real_2026_09']=round((full.iloc[-1]/full.loc['2020'].mean()-1)*100,1)
# margin proxy: domestic ppi vs import UV KRW
gap=np.log(D.ppi_sawn)-np.log(D.UVK/D.UVK.loc['2020'].mean()*100)
R['gap_by_year']={str(y):round((np.exp(gap.loc[str(y)].mean())-1)*100,1) for y in range(2016,2025)}
json.dump(R,open('stats8_out.json','w'),ensure_ascii=False,indent=1); print(json.dumps(R,ensure_ascii=False))
