import pandas as pd, glob, os
rows=[]
for f in sorted(glob.glob('dash/data/raw/*/*.csv')):
    if f.endswith('_total.csv'): continue
    d=pd.read_csv(f,dtype={'hs':str,'yyyymm':str})
    rows.append(d[d.hs.str.startswith('4407')])
df=pd.concat(rows)
df['ym']=pd.to_datetime(df.yyyymm,format='%Y%m')
df=df[(df.ym>='2016-01-01')&(df.ym<='2024-12-01')]
m=df.groupby('ym')[['imp_kg','imp_usd']].sum()
m['usd_per_kg']=m.imp_usd/m.imp_kg
m['t']=m.imp_kg/1000
pd.set_option('display.width',200)
print(m[['t','imp_usd','usd_per_kg']].round(3).to_string())
df.to_pickle('woodshock/hs4407.pkl')
