# Extension API for NHGrid based on SBMS

**Self-Bootstrapping Model Service** (SBMS) is a parallelizable framework designed for the execution of complex geographical model services on a single backend machine.

---

## What Is <font color=red>Async</font>

Some of the SBMS APIs are marked with <font color=red>**Async**</font>. It means that, if a model case, related to a specific async api request, has not existed, model will run asynchronously and return response with  content "NONE" at once.

---


## NextHydro

### Process Grid Information (<font color=red>Async</font>)

Process grid information into ne.txt and ns.txt. These result files will be compressed into a zip file.

```
POST /v0/nh/grid-process
```

**Request body schema**: application/json

```json
{
    "serialization": "{ serialized-grid-data }"
}
```

#### Responses  

<font color=green> **200** OK </font>  

**Response schema**: application/json

```json
{
    "case-id": "{ case-id }",
  	"model": "{ model-name }",
    "result": "{ result-file-name }" || "NONE"
}
```

