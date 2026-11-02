import json,numpy as np,pandas as pd,warnings,statsmodels.api as sm
warnings.filterwarnings('ignore')
df=pd.read_pickle('hs4407.pkl')
g=df.groupby(['ym','cnty_name'])[['imp_kg','imp_usd']].sum().reset_index()
g=g[(g.imp_kg>0)&(g.imp_usd>0)]
g['p']=g.imp_usd/g.imp_kg
months=sorted(g.ym.unique())
# chained monthly Fisher index over countries present in both months
idx=[100.0]; mixshare=[]
for a,b in zip(months[:-1],months[1:]):
    A=g[g.ym==a].set_index('cnty_name'); B=g[g.ym==b].set_index('cnty_name')
    c=A.index.intersection(B.index)
    A,B=A.loc[c],B.loc[c]
    las=(B.p*A.imp_kg).sum()/(A.p*A.imp_kg).sum(); paa=(B.p*B.imp_kg).sum()/(A.p*B.imp_kg).sum()
    idx.append(idx[-1]*np.sqrt(las*paa))
F=pd.Series(idx,index=pd.DatetimeIndex(months),name='FISHER')
M=pd.read_csv('merged2.csv',index_col=0,parse_dates=True).join(F)
# Eurostat by country
X='/home/claude/wood-trade-dashboard/data/external/'
d=json.load(open(X+'eurostat_ppi_c161.json')); dims=d['id']; size=d['size']; ix={k:d['dimension'][k]['category']['index'] for k in dims}
def eu(geo,unit='I21'):
    out={}
    for t,ti in ix['time'].items():
        pos=[{'time':ti,'geo':ix['geo'][geo],'unit':ix['unit'][unit]}.get(k,0) for k in dims]
        flat=0
        for j in range(len(dims)): flat=flat*size[j]+pos[j]
        v=d['value'].get(str(flat))
        if v is not None: out[pd.Timestamp(t)]=v
    return pd.Series(out,dtype=float).sort_index()
for geo in ['DE','SE','FI']: M['EU_'+geo]=eu(geo)
# weights = Korea import value 2016-2024 from DE, SE, FI
w=df[df.cnty_name.isin(['독일','스웨덴','핀란드'])].groupby('cnty_name').imp_usd.sum(); w=w/w.sum(); print('weights',w.round(3).to_dict())
M['EUW']=np.exp(w['독일']*np.log(M.EU_DE)+w['스웨덴']*np.log(M.EU_SE)+w['핀란드']*np.log(M.EU_FI))
R={}
# mix effect over 2021-01..10 cumulative
R['uv_logchg_2021']=round(np.log(M.P.loc['2021-10-01']/M.P.loc['2020-12-01']),4)
R['fisher_logchg_2021']=round(np.log(M.FISHER.loc['2021-10-01']/M.FISHER.loc['2020-12-01']),4)
def run(ycol,ecol,label,fit_end=None):
    D=M.copy(); D['dP']=np.log(D[ycol]).diff(); D['dL']=np.log(D.WPU0811).diff(); D['dE']=np.log(D[ecol]).diff(); D['dG']=D.GSCPI.diff(); D['dFX']=np.log(D.EXKOUS).diff()
    Z=pd.DataFrame({f'dL{l}':D.dL.shift(l) for l in range(7)})
    for l in range(4): Z[f'dG{l}']=D.dG.shift(l); Z[f'dE{l}']=D.dE.shift(l)
    Z['dFX']=D.dFX
    MM=pd.concat([D.dP,Z],axis=1).dropna()
    fit=MM if fit_end is None else MM.loc[:fit_end]
    m=sm.OLS(fit.dP,sm.add_constant(fit.drop(columns='dP'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
    per=MM.loc['2021-01-01':'2021-10-01']; act=per.dP.sum()
    pred=(sm.add_constant(per.drop(columns='dP'),has_constant='add')@m.params).sum()
    parts={'eu':sum((per[f'dE{l}']*m.params[f'dE{l}']).sum() for l in range(4)),'us':sum((per[f'dL{l}']*m.params[f'dL{l}']).sum() for l in range(7)),'gscpi':sum((per[f'dG{l}']*m.params[f'dG{l}']).sum() for l in range(4))}
    out={'n':int(m.nobs),'r2':round(m.rsquared,3),'adj':round(m.rsquared_adj,3),'actual':round(act,3),'pred':round(pred,3),'unexpl_pct':round((act-pred)/act*100,1),**{k:round(v/act*100,1) for k,v in parts.items()}}
    R[label]=out
run('P','EU','uv_EU27'); run('P','EUW','uv_EUw'); run('FISHER','EU','fisher_EU27'); run('FISHER','EUW','fisher_EUw')
run('P','EU','oos_uv_EU27',fit_end='2020-12-01'); run('FISHER','EUW','oos_fisher_EUw',fit_end='2020-12-01'); run('FISHER','EU','oos_fisher_EU27',fit_end='2020-12-01')
json.dump(R,open('stats4_out.json','w'),ensure_ascii=False,indent=1)
print(json.dumps(R,ensure_ascii=False,indent=0))
M[['FISHER','EUW']].to_csv('extra4.csv')
