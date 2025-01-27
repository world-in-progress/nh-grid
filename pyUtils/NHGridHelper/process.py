import numpy as np

Mesh_file="./output/ne.txt"
Side_file="./output/ns.txt"
Bd_file="./output/bd.txt"
Meshbln_file="./output/mesh.bln"
Center_file="./output/xyz.dat"
Ie_file="./output/ie.dat"
Is_file="./output/is.dat"

ns = 0      # num of sides
ne = 0      # num of elements
nbd_ie = 0  # num of boundary elements

with open(Mesh_file, 'r', encoding='utf-8') as file:
    lines = file.readlines()
    ne = len(lines)
    for line in lines:
        data = line.strip().split(',')
        ne = max(int(data[0]),ne)
    print('Num of elements: ',ne)


with open(Side_file, 'r', encoding='utf-8') as file:
    lines = file.readlines()
    ns = len(lines)
    for line in lines:
        data = line.strip().split(',')
        ns = max(int(data[0]), ns)
    print('Num of sides: ',ns) 
 
xe = np.zeros(ne + 1, dtype = np.float32)
ye = np.zeros(ne + 1, dtype = np.float32)
ze = np.zeros(ne + 1, dtype = np.float32)
type_e = np.zeros(ne + 1, dtype = np.int32)   # type of element

nsl1 = np.zeros(ne + 1, dtype = np.int32)
nsl2 = np.zeros(ne + 1, dtype = np.int32)
nsl3 = np.zeros(ne + 1, dtype = np.int32)
nsl4 = np.zeros(ne + 1, dtype = np.int32)
isl1 = np.zeros((ne + 1, 10), dtype = np.int32)
isl2 = np.zeros((ne + 1, 10), dtype = np.int32)
isl3 = np.zeros((ne + 1, 10), dtype = np.int32)
isl4 = np.zeros((ne + 1, 10), dtype = np.int32)

ise = np.zeros((ns + 1, 5), dtype = np.int32)
dis = np.zeros(ns + 1, dtype = np.float32)
x_side = np.zeros(ns+1, dtype = np.float32)
y_side = np.zeros(ns+1, dtype = np.float32)
z_side = np.zeros(ns+1, dtype = np.float32)

xd = np.zeros((ne + 1, 3), dtype = np.float32)
yd = np.zeros((ne + 1, 3), dtype = np.float32)

bd_ie = np.zeros((ne + 1), dtype = np.int32)
ibd_ie = np.zeros((ne + 1), dtype = np.int32)

GE = np.zeros((2000000, 4), dtype = np.int32)
GNN = np.zeros((2000000, 4), dtype = np.float32)

Tpnd = np.zeros((2000000), dtype = np.int32)

# Parse element file
with open(Mesh_file, 'r', encoding='utf-8') as file:
    
    lines = file.readlines()
    for line in lines:
        data = line.strip().split(',')
        index_ne = int(data[0])             # element index
        
        xe[index_ne] = float(data[-4])      # element x
        ye[index_ne] = float(data[-3])      # element y
        ze[index_ne] = float(data[-2])      # element z
        type_e[index_ne] = int(data[-1])    # element type

        nsl1[index_ne] = int(data[1])       # left edge num of element 
        nsl2[index_ne] = int(data[2])       # right edge num of element
        nsl3[index_ne] = int(data[3])       # bottom edge num of element
        nsl4[index_ne] = int(data[4])       # top edge num of element

        for i in range(nsl1[index_ne]):
            isl1[index_ne][i + 1] = int(data[5 + i])
        for i in range(nsl2[index_ne]):
            isl2[index_ne][i + 1] = int(data[5 + nsl1[index_ne] + i])
        for i in range(nsl3[index_ne]):
            isl3[index_ne][i + 1] = int(data[5 + nsl1[index_ne] + nsl2[index_ne] + i])
        for i in range(nsl4[index_ne]):
            isl4[index_ne][i + 1] = int(data[5 + nsl1[index_ne] + nsl2[index_ne] + nsl3[index_ne] + i])

# Parse side file
with open(Side_file, 'r', encoding='utf-8') as file:
    
    lines = file.readlines()
    sideNum = len(lines)
    for line in lines:
        data = line.strip().split(',')
        index_ns = int(data[0])             # side index
        
        ise[index_ns][0] = int(data[1])     # side direction
        
        ise[index_ns][1] = int(data[2])     # left grid index
        ise[index_ns][2] = int(data[3])     # right grid index
        ise[index_ns][3] = int(data[4])     # bottom grid index
        ise[index_ns][4] = int(data[5])     # top grid index
        
        dis[index_ns] = float(data[6])      # side length
        
        x_side[index_ns] =float(data[7])    # side center x
        y_side[index_ns] = float(data[8])   # side center y
        z_side[index_ns] = float(data[9])   # side center z

# Generate boundary file
with open(Bd_file, 'w', encoding='utf-8') as file:

    for i in range(1, ns + 1):
        
        ie = 0
        
        # Case of horizontal side
        if ise[i][0] == 1:    
            if min(ise[i][3], ise[i][4]) == 0:
                ie = max(ise[i][3], ise[i][4])

        # Case of vertical side
        else:
            if min(ise[i][1], ise[i][2]) == 0:
                ie = max(ise[i][1], ise[i][2])
                
        if ie != 0 and xe[ie] < 826105.954993 and ye[ie] < 843403.753622:
            bd_ie[ie] = 1
            nbd_ie = nbd_ie + 1
            ibd_ie[nbd_ie] = ie
            file.write(f"{xe[ie]},{ye[ie]},{ie},{ise[i][0]}\n")

# Generate element mesh file
with open(Meshbln_file, 'w', encoding = 'utf-8') as file:
    for i in range(1, ns + 1):
        
        if ise[i][0] == 1:
            file.write(f"{2}\n")
            file.write(f"{x_side[i]-dis[i]/2.},{y_side[i]}\n")
            file.write(f"{x_side[i]+dis[i]/2.},{y_side[i]}\n")
            
        if ise[i][0] == 2:
            file.write(f"{2}\n")
            file.write(f"{x_side[i]},{y_side[i] - dis[i]/2.}\n")
            file.write(f"{x_side[i]},{y_side[i]+dis[i]/2.}\n")

# Generate element center file
with open(Center_file, 'w', encoding = 'utf-8') as file:
    for i in range(1, ne + 1):
        file.write(f"{xe[i]},{ye[i]},{ze[i]}\n")

# Generate pure element file
with open(Ie_file, 'w', encoding = 'utf-8') as file:
    for i in range(1, ne + 1):
        file.write(f"{xe[i]},{ye[i]},{i}\n")

# Generate pure side file
with open(Is_file, 'w', encoding = 'utf-8') as file:
    for i in range(1, ns + 1):
        file.write(f"{x_side[i]},{y_side[i]},{i}\n")

# Check edges of elemets valid or not
for ie in range(1, ne + 1):
    dis1 = 0
    dis2 = 0
    dis3 = 0
    dis4 = 0
    
    for i in range(1, nsl1[ie] + 1):
        iside = isl1[ie,i]
        dis1 = dis1 + dis[iside]

    for i in range(1, nsl2[ie] + 1):
        iside = isl2[ie,i]
        dis2 = dis2 + dis[iside]

    for i in range(1, nsl3[ie] + 1):
        iside = isl3[ie,i]
        dis3 = dis3 + dis[iside]

    for i in range(1, nsl4[ie] + 1):
        iside = isl4[ie, i]
        dis4 = dis4 + dis[iside]

    if abs(dis2 - dis1) > 0.1:
        print("wrong dis1 dis2 ", ie, dis1, dis2)
    if abs(dis3 - dis4) > 0.1:
        print("wrong dis3 dis4 ", ie, dis3, dis4)
