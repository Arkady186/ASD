import sys, numpy as np; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import unproj, p
from fit2 import proj
from cand import C
CENTER={'E3','E4','E5'}
H={k:78.0 for k in C}; H.update({'E1':72,'E2':72,'E3':66,'E4':66,'E5':66})
D=17.5
f_,Cam,F,Rt,U=__import__('fit2').basis(p)
def box(name):
    a,b=C[name]; h=H[name]
    A=unproj(*a,y=h); B=unproj(*b,y=h)
    ax=B-A; ax[1]=0; L=np.linalg.norm(ax); ax/=L
    n=np.array([-ax[2],0,ax[0]])
    mid=(A+B)/2
    tocam=Cam-mid; tocam[1]=0
    if n@tocam>0: n=-n   # n points away from camera
    if name in CENTER: base=mid-n*D/2
    else: base=mid
    c0=base-ax*L/2; c1=base+ax*L/2; c2=c1+n*D; c3=c0+n*D
    return dict(name=name,center=(c0+c1+c2+c3)/4,L=L,D=D,H=h,ang=float(np.arctan2(ax[2],ax[0])),corners=[c0,c1,c2,c3])
if __name__=='__main__':
    from PIL import Image, ImageDraw
    im=Image.open('/home/claude/asd/assets/img/kvartal.webp').convert('RGB'); d=ImageDraw.Draw(im)
    for n in C:
        bx=box(n); cs=bx['corners']
        for y in (0,bx['H']):
            pts=proj(p,[c*[1,0,1]+[0,y,0] for c in cs]); d.polygon([tuple(q) for q in pts],outline=(0,255,255))
        for c in cs:
            q=proj(p,[c*[1,0,1],c*[1,0,1]+[0,bx['H'],0]]); d.line([tuple(q[0]),tuple(q[1])],fill=(0,255,255))
        q=proj(p,[bx['center']*[1,0,1]+[0,bx['H'],0]])[0]; d.text((q[0],q[1]-14),n,fill=(255,255,0))
        print(n, np.round(bx['center'][[0,2]],1), round(bx['L'],1), round(np.degrees(bx['ang']),1))
    im.save('/tmp/cal/ov.png')
