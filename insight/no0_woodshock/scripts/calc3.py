import pandas as pd, json
df=pd.read_pickle('woodshock/hs4407.pkl'); df['y']=df.ym.dt.year
a=df.groupby(['y','cnty_name'])[['imp_kg','imp_usd']].sum()
d21=(a.loc[2021].imp_usd-a.loc[2020].imp_usd.reindex(a.loc[2021].index).fillna(0)).sort_values(ascending=False)/1e6
print('contrib 20->21'); print(d21.head(6).round(1))
d22=((a.loc[2022].imp_kg.reindex(a.loc[2021].index).fillna(0)-a.loc[2021].imp_kg)/1e3).sort_values()
print('vol change 21->22 (t)'); print(d22.head(6).round(0))
m=df[df.ym.between('2019-01-01','2023-12-01')].groupby('ym')[['imp_kg','imp_usd']].sum()
m['p']=m.imp_usd/m.imp_kg
base=m.loc['2020'].imp_usd.sum()/m.loc['2020'].imp_kg.sum()
print('2020 avg',base,'peak',m.p.idxmax(),m.p.max(),(m.p.max()/base-1)*100)
# quarterly index by country 2020=100
q=df[df.ym.between('2019-01-01','2023-12-01')].groupby([pd.Grouper(key='ym',freq='QS'),'cnty_name'])[['imp_kg','imp_usd']].sum().reset_index()
q['p']=q.imp_usd/q.imp_kg
out={}
for c in ['캐나다','러시아 연방','독일','칠레','뉴질랜드']:
    s=q[q.cnty_name==c].set_index('ym').p
    b=a.loc[(2020,c)].imp_usd/a.loc[(2020,c)].imp_kg
    idx=(s/b*100).round(1)
    print(c,'peak',idx.idxmax().strftime('%Y-%m'),idx.max())
    out[c]={k.strftime('%Y-Q')+str((k.month-1)//3+1):v for k,v in idx.items()}
ser={'months':[d.strftime('%Y-%m') for d in m.index],'t':(m.imp_kg/1e3).round(0).tolist(),'p':m.p.round(3).tolist()}
json.dump({'monthly':ser,'qidx':out},open('woodshock/series.json','w'),ensure_ascii=False)
