/**
 * @name Ruta Fastify que lee datos del cliente sin esquema de validación
 * @description Una ruta lee request.body, request.query o request.params pero no declara
 *              la parte correspondiente en `schema`. Los tipos de TypeScript desaparecen al
 *              compilar, así que en tiempo de ejecución puede llegar cualquier valor JSON
 *              (objeto, arreglo, número) donde el código espera un string.
 * @kind problem
 * @problem.severity warning
 * @security-severity 5.3
 * @precision high
 * @id enlaceseguro/fastify-ruta-sin-schema
 * @tags security
 *       external/cwe/cwe-20
 *       external/cwe/cwe-843
 */

import javascript

/** Una llamada que registra una ruta HTTP en una instancia de Fastify. */
class RutaFastify extends DataFlow::MethodCallNode {
  RutaFastify() {
    this.getMethodName() = ["get", "head", "post", "put", "patch", "delete", "options", "all"] and
    exists(this.getArgument(0).getStringValue()) and
    (
      this instanceof Fastify::RouteSetup
      or
      this.getReceiver().hasUnderlyingType("fastify", "FastifyInstance")
      or
      this.getReceiver().asExpr().(VarAccess).getName() = ["fastify", "server", "app"]
    )
  }

  /** La función que atiende la ruta (último argumento). */
  DataFlow::FunctionNode getManejador() { result = this.getLastArgument().getALocalSource() }

  /** El objeto de opciones de la ruta: `fastify.post(url, opciones, manejador)`. */
  DataFlow::ObjectLiteralNode getOpciones() {
    this.getNumArgument() = 3 and result = this.getArgument(1).getALocalSource()
  }

  /** Se cumple si `schema` declara la parte indicada (body, querystring o params). */
  bindingset[parte]
  predicate declaraSchema(string parte) {
    exists(DataFlow::SourceNode schema |
      schema = this.getOpciones().getAPropertyWrite("schema").getRhs().getALocalSource()
    |
      exists(schema.(DataFlow::ObjectLiteralNode).getAPropertyWrite(parte))
      or
      // Si el esquema viene de otro lado (import, función), no podemos verlo: se da por bueno.
      not schema instanceof DataFlow::ObjectLiteralNode
    )
  }
}

/** Relación entre la propiedad leída del request y la llave de `schema` que la valida. */
string llaveSchema(string propiedad) {
  propiedad = "body" and result = "body"
  or
  propiedad = "query" and result = "querystring"
  or
  propiedad = "params" and result = "params"
}

from RutaFastify ruta, DataFlow::PropRead lectura, string propiedad
where
  lectura = ruta.getManejador().getParameter(0).getAPropertyRead(propiedad) and
  exists(llaveSchema(propiedad)) and
  not ruta.declaraSchema(llaveSchema(propiedad))
select lectura,
  "La ruta $@ lee request." + propiedad + " sin declarar schema." + llaveSchema(propiedad) +
    "; Fastify no valida el tipo y el valor llega tal cual al caso de uso.", ruta,
  ruta.getMethodName().toUpperCase() + " " + ruta.getArgument(0).getStringValue()
