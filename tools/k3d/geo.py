import os
import numpy as np
from fit2 import basis, proj, cx, cy
p=np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fit2.npy'))
def unproj(u,v,y=0):
    f,C,F,Rt,U=basis(p)
    d=F+Rt*(u-cx)/f+U*(-(v-cy))/f
    t=(y-C[1])/d[1]; return C+t*d
def height_at(base,top):
    g=unproj(*base)
    for H in np.arange(0,150,0.5):
        q=proj(p,[g+[0,H,0]])[0]
        if q[1]<=top[1]: return H,g
    return None,g
