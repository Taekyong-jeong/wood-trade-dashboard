import json,numpy as np,pandas as pd,warnings,statsmodels.api as sm
from statsmodels.tsa.stattools import grangercausalitytests
warnings.filterwarnings('ignore')
c=pd.read_csv('comtrade.csv'); c.index=pd.to_datetime(c.period.astype(str),format='%Y%m')
M=pd.read_csv('merged2.csv',index_col=0,parse_dates=True).join(pd.read_csv('extra4.csv',index_col=0,parse_dates=True))
print('KR check', round(c.kr_world_kusd.sum()/1e3,1),'M vs ours',round((M.P*M.Q).sum()/1e3,1))
c['ru_cn_p']=c.cn_ru_kusd/c.cn_ru_t  # USD/kg
df=pd.read_pickle('hs4407.pkl'); kr_ru=df[df.cnty_name=='러시아 연방'].groupby('ym')[['imp_kg','imp_usd']].sum(); kr_ru_p=kr_ru.imp_usd/kr_ru.imp_kg
D=M.join(c[['ru_cn_p']]).join(kr_ru_p.rename('kr_ru_p'))
R={}
R['corr_dln_kr_ru_vs_cn_ru']={str(k):round(np.log(D.kr_ru_p).diff().corr(np.log(D.ru_cn_p).diff().shift(k)),3) for k in range(0,4)}
R['corr_level']=round(np.log(D.kr_ru_p).corr(np.log(D.ru_cn_p)),3)
y=c.groupby(c.index.year).sum()
sh=pd.DataFrame({'cn':y.cn_ru_kusd/y.cn_world_kusd*100,'jp':y.jp_ru_kusd/y.jp_world_kusd*100,'kr':y.kr_ru_kusd/y.kr_world_kusd*100,'cn_ru_t':y.cn_ru_t/1e3,'ru_p_cn':y.cn_ru_kusd/y.cn_ru_t}).round(2)
print(sh)
R['shares']=sh.round(2).to_dict()
def run(ycol,label,extra=True,fit_end=None):
    X=D.copy(); X['dP']=np.log(X[ycol]).diff(); X['dL']=np.log(X.WPU0811).diff(); X['dE']=np.log(X.EU).diff(); X['dG']=X.GSCPI.diff(); X['dFX']=np.log(X.EXKOUS).diff(); X['dR']=np.log(X.ru_cn_p).diff()
    Z=pd.DataFrame({f'dL{l}':X.dL.shift(l) for l in range(7)})
    for l in range(4): Z[f'dG{l}']=X.dG.shift(l); Z[f'dE{l}']=X.dE.shift(l)
    if extra:
        for l in range(4): Z[f'dR{l}']=X.dR.shift(l)
    Z['dFX']=X.dFX
    MM=pd.concat([X.dP,Z],axis=1).dropna(); fit=MM if fit_end is None else MM.loc[:fit_end]
    m=sm.OLS(fit.dP,sm.add_constant(fit.drop(columns='dP'))).fit(cov_type='HAC',cov_kwds={'maxlags':6})
    per=MM.loc['2021-01-01':'2021-10-01']; act=per.dP.sum(); pred=(sm.add_constant(per.drop(columns='dP'),has_constant='add')@m.params).sum()
    grp=lambda p:sum((per[c]*m.params[c]).sum() for c in m.params.index if c.startswith(p))
    out={'n':int(m.nobs),'r2':round(m.rsquared,3),'adj':round(m.rsquared_adj,3),'unexpl_pct':round((act-pred)/act*100,1),'eu':round(grp('dE')/act*100,1),'us':round(grp('dL')/act*100,1),'gscpi':round(grp('dG')/act*100,1)}
    if extra:
        out['ru']=round(grp('dR')/act*100,1); Rc=[f'dR{l}' for l in range(4)]
        out['joint_R_p']=round(float(m.f_test(', '.join(f'{c}=0' for c in Rc)).pvalue),4)
        out['coefR']={c:[round(m.params[c],3),round(m.pvalues[c],4)] for c in Rc}
    R[label]=out
run('P','uv_noR',extra=False); run('P','uv_R'); run('FISHER','fisher_R'); run('P','oos_uv_R',fit_end='2020-12-01')
X=D.copy(); X['dP']=np.log(X.P).diff(); X['dR']=np.log(X.ru_cn_p).diff()
t=grangercausalitytests(X[['dP','dR']].dropna(),maxlag=6); R['granger_R_to_P']={str(l):round(t[l][0]['ssr_ftest'][1],4) for l in t}
json.dump(R,open('stats6_out.json','w'),ensure_ascii=False,indent=1)
print(json.dumps({k:v for k,v in R.items() if k!='shares'},ensure_ascii=False))
