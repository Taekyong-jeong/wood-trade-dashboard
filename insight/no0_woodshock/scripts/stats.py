import json, numpy as np, pandas as pd, warnings
import statsmodels.api as sm
from statsmodels.tsa.stattools import adfuller, grangercausalitytests, coint
warnings.filterwarnings('ignore')
df=pd.read_pickle('hs4407.pkl')
k=df.groupby('ym')[['imp_kg','imp_usd']].sum()
k=k.loc['2016-01-01':'2024-12-01']
f=json.load(open('fred.json'))
idx=pd.date_range('2016-01-01',periods=108,freq='MS')
X=pd.DataFrame({k2:f[k2] for k2 in ['WPU0811','EXKOUS','HOUST','GSCPI']},index=idx)
D=k.join(X); D['P']=D.imp_usd/D.imp_kg; D['Q']=D.imp_kg/1e3
D['lP']=np.log(D.P); D['lL']=np.log(D.WPU0811); D['lFX']=np.log(D.EXKOUS); D['lH']=np.log(D.HOUST); D['lQ']=np.log(D.Q)
D['dP']=D.lP.diff(); D['dL']=D.lL.diff(); D['dG']=D.GSCPI.diff(); D['dFX']=D.lFX.diff()
R={}
# stationarity
for c in ['lP','lL','dP','dL','GSCPI','dG']:
    s=D[c].dropna(); R['adf_'+c]=round(adfuller(s,autolag='AIC')[1],4)
# cross correlation dP vs dL lag k (L leads)
R['ccf_dL']={str(kk): round(D.dP.corr(D.dL.shift(kk)),3) for kk in range(0,9)}
R['ccf_G']={str(kk): round(D.lP.diff().corr(D.GSCPI.shift(kk).diff()),3) for kk in range(0,9)}
R['corr_level_G']={str(kk): round(D.lP.corr(D.GSCPI.shift(kk)),3) for kk in range(0,9)}
# distributed lag model
lags=range(0,7)
Z=pd.DataFrame({f'dL{l}':D.dL.shift(l) for l in lags})
for l in range(0,4): Z[f'dG{l}']=D.dG.shift(l)
Z['dFX']=D.dFX
M=pd.concat([D.dP,Z],axis=1).dropna()
mod=sm.OLS(M.dP,sm.add_constant(M.drop(columns='dP'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
R['dl_n']=int(mod.nobs); R['dl_r2']=round(mod.rsquared,3); R['dl_adjr2']=round(mod.rsquared_adj,3)
R['dl_coef']={c:[round(mod.params[c],4),round(mod.pvalues[c],4)] for c in mod.params.index}
Lc=[f'dL{l}' for l in lags]; Gc=[f'dG{l}' for l in range(4)]
w=mod.wald_test(' + '.join(Lc)+' = 0',scalar=True); R['lr_L']=[round(sum(mod.params[c] for c in Lc),4),round(float(w.pvalue),5)]
w=mod.wald_test(' + '.join(Gc)+' = 0',scalar=True); R['lr_G']=[round(sum(mod.params[c] for c in Gc),4),round(float(w.pvalue),5)]
# joint F test
R['joint_L_p']=round(float(mod.f_test(', '.join(f'{c}=0' for c in Lc)).pvalue),5)
R['joint_G_p']=round(float(mod.f_test(', '.join(f'{c}=0' for c in Gc)).pvalue),5)
R['FX_p']=round(mod.pvalues['dFX'],4)
# contribution 2020-12 -> 2021-10 of fitted components
per=M.loc['2021-01-01':'2021-10-01']
cL=sum((per[c]*mod.params[c]).sum() for c in Lc); cG=sum((per[c]*mod.params[c]).sum() for c in Gc)
cFX=(per['dFX']*mod.params['dFX']).sum(); actual=per.dP.sum(); const=mod.params['const']*len(per)
R['contrib_2021']={'actual_logchg':round(actual,4),'lumber':round(cL,4),'gscpi':round(cG,4),'fx':round(cFX,4),'const':round(const,4),'resid':round(actual-cL-cG-cFX-const,4)}
# Granger
def gp(y,x,ml=6):
    t=grangercausalitytests(D[[y,x]].dropna(),maxlag=ml)
    return {str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
R['granger_L_to_P']=gp('dP','dL'); R['granger_P_to_L']=gp('dL','dP')
R['granger_G_to_P']=gp('dP','dG'); R['granger_H_to_L']=gp('dL',None) if False else None
D['dH']=D.lH.diff(); R['granger_H_to_L']=gp('dL','dH')
# cointegration lP ~ lL
c=coint(D.lP,D.lL); R['coint_P_L_p']=round(c[1],4)
lr=sm.OLS(D.lP,sm.add_constant(D.lL)).fit(); R['coint_beta']=round(lr.params['lL'],3)
# volume model: YoY growth
D['gQ']=np.log(D.Q.rolling(3).mean()).diff(12); D['gFX']=D.lFX.diff(12); D['gP']=D.lP.diff(12)
for lag in [0,3,6]:
    V=pd.concat([D.gQ,D.gFX.shift(lag).rename('gFX'),D.gP.shift(lag).rename('gP')],axis=1).dropna()
    vm=sm.OLS(V.gQ,sm.add_constant(V[['gFX','gP']])).fit(cov_type='HAC',cov_kwds={'maxlags':12})
    R[f'vol_lag{lag}']={'n':int(vm.nobs),'r2':round(vm.rsquared,3),'gFX':[round(vm.params.gFX,3),round(vm.pvalues.gFX,4)],'gP':[round(vm.params.gP,3),round(vm.pvalues.gP,4)]}
json.dump(R,open('stats_out.json','w'),ensure_ascii=False,indent=1,default=str)
print(json.dumps(R,ensure_ascii=False,indent=1,default=str))
D[['P','Q','WPU0811','EXKOUS','HOUST','GSCPI']].to_csv('merged.csv')
