import sys, os
sys.path.insert(0, r'D:\github\wizardaax\SCE-88')
os.chdir(r'D:\github\wizardaax\SCE-88')
from validation.validator import instantiate_unit

def build():
    unit = instantiate_unit()
    unit.validate()
    for domain in unit.domains:
        print(f"{domain.name}: {len(domain.levels)} levels validated")

if __name__ == "__main__":
    build()
