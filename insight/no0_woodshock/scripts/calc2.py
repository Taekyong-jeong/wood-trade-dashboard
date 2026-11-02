import pandas as pd, numpy as np
df=pd.read_pickle('woodshock/hs4407.pkl')
df['y']=df.ym.dt.year
a=df[df.y.between(2019,2023)].groupby(['y','cnty_name'])[['imp_kg','imp_usd']].sum().reset_index()
tot=a.groupby('y')[['imp_kg','imp_usd']].sum()
tot['p']=tot.imp_usd/tot.imp_kg
print('ANNUAL'); print((tot.assign(t=tot.imp_kg/1e3,musd=tot.imp_usd/1e6)[['t','musd','p']]).round(3))
for y in [2020,2021,2022,2023]:
    s=a[a.y==y].copy(); s['share_t']=s.imp_kg/s.imp_kg.sum()*100; s['share_usd']=s.imp_usd/s.imp_usd.sum()*100; s['p']=s.imp_usd/s.imp_kg
    print(y); print(s.sort_values('imp_usd',ascending=False).head(8)[['cnty_name','imp_kg','imp_usd','share_t','share_usd','p']].round(3).to_string(index=False))
def L(a,b): return (a-b)/(np.log(a)-np.log(b)) if a!=b else a
def lmdi(y0,y1):
    x0=a[a.y==y0].set_index('cnty_name'); x1=a[a.y==y1].set_index('cnty_name')
    Q0,Q1=x0.imp_kg.sum(),x1.imp_kg.sum()
    act=st=pr=0; ent=0
    for c in set(x0.index)|set(x1.index):
        if c in x0.index and c in x1.index and x0.loc[c,'imp_kg']>0 and x1.loc[c,'imp_kg']>0 and x0.loc[c,'imp_usd']>0 and x1.loc[c,'imp_usd']>0:
            V0,V1=x0.loc[c,'imp_usd'],x1.loc[c,'imp_usd']
            w=L(V1,V0)
            s0,s1=x0.loc[c,'imp_kg']/Q0,x1.loc[c,'imp_kg']/Q1
            p0,p1=V0/x0.loc[c,'imp_kg'],V1/x1.loc[c,'imp_kg']
            act+=w*np.log(Q1/Q0); st+=w*np.log(s1/s0); pr+=w*np.log(p1/p0)
        else:
            ent+=(x1.imp_usd.get(c,0) if c in x1.index else 0)-(x0.imp_usd.get(c,0) if c in x0.index else 0)
    dV=x1.imp_usd.sum()-x0.imp_usd.sum()
    print(f'{y0}->{y1} dV={dV/1e6:.1f}M  volume={act/1e6:.1f}  mix={st/1e6:.1f}  price={pr/1e6:.1f}  entry/exit={ent/1e6:.1f}  check={(act+st+pr+ent-dV)/1e6:.3f}')
for p in [(2019,2020),(2020,2021),(2021,2022),(2022,2023)]: lmdi(*p)
# monthly unit price top countries
top=['뉴질랜드','러시아 연방','칠레','캐나다','미국','핀란드','스웨덴','독일','오스트리아','중국']
m=df[df.ym.between('2019-01-01','2023-12-01')].groupby([pd.Grouper(key='ym',freq='QS'),'cnty_name'])[['imp_kg','imp_usd']].sum().reset_index()
m['p']=m.imp_usd/m.imp_kg
pv=m[m.cnty_name.isin(top)].pivot(index='ym',columns='cnty_name',values='p').round(3)
print(pv.to_string())
