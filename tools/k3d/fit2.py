import numpy as np
from scipy.optimize import least_squares
cx,cy=960,547
img=np.array([[953.75,362],[1046.25,383.75],[895,447],[993.75,473.75]])
W,L=68,105
wld=np.array([[-W/2,0,-L/2],[W/2,0,-L/2],[-W/2,0,L/2],[W/2,0,L/2]])
lines=[((713.3,761.7),0.154,1),((851.7,636.7),0.034,1),((1158,507),-0.018,1),((86.7,305),0.45,0.5),((686,751.7),0.165,1)]
def basis(p):
    f,X,h,Z,tx,tz,roll=p
    C=np.array([X,h,Z]); F=np.array([tx,0,tz])-C; F/=np.linalg.norm(F)
    Rt=np.cross(F,[0,1,0]); Rt/=np.linalg.norm(Rt); U=np.cross(Rt,F)
    c,s=np.cos(roll),np.sin(roll); Rt2=c*Rt+s*U; U2=-s*Rt+c*U
    return f,C,F,Rt2,U2
def proj(p,P):
    f,C,F,Rt,U=basis(p); d=np.asarray(P)-C
    z=d@F; return np.stack([cx+f*(d@Rt)/z, cy-f*(d@U)/z],1)
def vvp(p):
    f,C,F,Rt,U=basis(p); d=np.array([0,-1.,0]); z=d@F
    return np.array([cx+f*(d@Rt)/z, cy-f*(d@U)/z])
def res(p):
    r=list((proj(p,wld)-img).ravel()); v=vvp(p)
    for (pt,s,w) in lines:
        dv=v-np.array(pt); a1=np.arctan2(dv[0],dv[1]); r.append((a1-np.arctan(s))*400*w)
    return r
if __name__=='__main__':
    best=None
    for ang in np.linspace(0,2*np.pi,24,endpoint=False):
      for dist in [600,1000,1600]:
        for hr in [0.6,1.0,1.5]:
          for f0 in [1200,2200,3500]:
            p0=[f0,dist*np.cos(ang),dist*hr,dist*np.sin(ang),0,0,0]
            try: s=least_squares(res,p0,bounds=([300,-5000,30,-5000,-2000,-2000,-.5],[9000,5000,5000,5000,2000,2000,.5]),max_nfev=3000)
            except Exception: continue
            if best is None or s.cost<best.cost: best=s
    p=best.x; print('cost',best.cost, np.round(p,2))
    print(np.round(proj(p,wld),1)); print('vp',vvp(p),'vfov',np.degrees(2*np.arctan(547/p[0])))
    print(np.round(res(p),2)); np.save('fit2.npy',p)
